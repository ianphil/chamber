import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/mock') } }));

// Mock child_process (used by initGit / bootstrapCapabilities)
vi.mock('child_process', () => ({ execSync: vi.fn() }));

// Mock fs
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => ['test.agent.md']),
}));

// Fake SDK session
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
  if (event === 'session.idle') setTimeout(() => cb(), 0);
  return vi.fn();
});

const mockCreateSession = vi.fn(async () => ({
  send: mockSend,
  destroy: mockDestroy,
  on: mockOn,
}));

const fakeClient = { createSession: mockCreateSession };
const mockCreateClient = vi.fn(async () => fakeClient);
const mockDestroyClient = vi.fn().mockResolvedValue(undefined);

const fakeFactory = {
  createClient: mockCreateClient,
  destroyClient: mockDestroyClient,
};

// Mock dependencies that MindScaffold imports but aren't under test
vi.mock('../sdk/CopilotClientFactory', () => ({
  CopilotClientFactory: vi.fn().mockImplementation(() => fakeFactory),
}));
vi.mock('./GitHubRegistryClient', () => {
  return {
    GitHubRegistryClient: class FakeRegistryClient {},
  };
});
vi.mock('./genesisPrompt', () => ({
  buildGenesisPrompt: vi.fn(() => 'test genesis prompt'),
}));

import { MindScaffold } from './MindScaffold';

describe('MindScaffold.generateSoul — CopilotClientFactory integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire defaults so session.idle fires immediately
    mockOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'session.idle') setTimeout(() => cb(), 0);
      return vi.fn();
    });
  });

  it('calls createClient with the mind path', async () => {
    const scaffold = new MindScaffold(undefined, fakeFactory as unknown as CopilotClientFactory);

    await scaffold.create({
      name: 'alpha',
      role: 'assistant',
      voice: 'neutral',
      voiceDescription: 'calm and steady',
      basePath: 'C:\\agents',
    });

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(expect.stringContaining('alpha'));
  });

  it('destroys the client after soul generation succeeds', async () => {
    const scaffold = new MindScaffold(undefined, fakeFactory as unknown as CopilotClientFactory);

    await scaffold.create({
      name: 'bravo',
      role: 'assistant',
      voice: 'neutral',
      voiceDescription: 'warm',
      basePath: 'C:\\agents',
    });

    expect(mockDestroyClient).toHaveBeenCalledTimes(1);
    expect(mockDestroyClient).toHaveBeenCalledWith(fakeClient);
    // destroy happens after session.destroy
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the client even when session.send throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('send boom'));
    const scaffold = new MindScaffold(undefined, fakeFactory as unknown as CopilotClientFactory);

    await expect(
      scaffold.create({
        name: 'charlie',
        role: 'assistant',
        voice: 'neutral',
        voiceDescription: 'dry',
        basePath: 'C:\\agents',
      }),
    ).rejects.toThrow('send boom');

    // Client must still be cleaned up
    expect(mockDestroyClient).toHaveBeenCalledWith(fakeClient);
  });
});
