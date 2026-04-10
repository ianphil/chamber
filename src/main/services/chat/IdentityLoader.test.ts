import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { IdentityLoader } from './IdentityLoader';

describe('IdentityLoader', () => {
  const loader = new IdentityLoader();
  beforeEach(() => vi.clearAllMocks());

  it('returns null when mindPath is null', () => {
    expect(loader.load(null)).toBeNull();
  });

  it('loads SOUL.md content', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Agent\nI am an agent.');
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    expect(loader.load('C:\\test')).toContain('I am an agent.');
  });

  it('strips YAML frontmatter from agent files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('# Soul')
      .mockReturnValueOnce('---\nname: test\n---\nInstructions');
    vi.mocked(fs.readdirSync).mockReturnValue(['main.agent.md'] as any);
    const identity = loader.load('C:\\test');
    expect(identity).toContain('Instructions');
    expect(identity).not.toContain('name: test');
  });

  it('returns null when nothing exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loader.load('C:\\test')).toBeNull();
  });
});
