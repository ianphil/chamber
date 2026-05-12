import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SquadBridgeRunner } from './SquadBridgeRunner';
import { FakeSquadBridgeRunner } from './SquadBridgeRunner';
import { SquadRoomService, resolveRepositoryPath } from './SquadRoomService';

describe('SquadRoomService', () => {
  it('returns an unselected snapshot when no repo is selected', async () => {
    await expect(new SquadRoomService().getRoom()).resolves.toMatchObject({
      status: 'unselected',
      repoPath: null,
      squadPath: null,
    });
  });

  it('returns missing for a repo without .squad', async () => {
    const repo = await createTempRepo();

    await expect(new SquadRoomService().getRoom(repo)).resolves.toMatchObject({
      status: 'missing',
      repoPath: repo,
      squadPath: path.join(repo, '.squad'),
    });
  });

  it('loads a ready Squad room snapshot', async () => {
    const repo = await createTempRepo();
    await writeSquadFixture(repo);

    const snapshot = await new SquadRoomService().getRoom(repo);

    expect(snapshot.status).toBe('ready');
    expect(snapshot.version).toBe(1);
    expect(snapshot.coordinator).toMatchObject({ name: 'Squad', role: 'Coordinator' });
    expect(snapshot.agents).toEqual([
      { name: 'Trinity', role: 'Frontend', charterPath: 'agents/trinity/charter.md', status: 'ready' },
    ]);
    expect(snapshot.routingRules).toEqual([
      { workType: 'Frontend', routeTo: 'Trinity', examples: 'React UI' },
    ]);
    expect(snapshot.decisions).toEqual([
      { title: 'Use React', body: 'Keep the renderer native.' },
    ]);
    expect(snapshot.sessions).toEqual(['session-1.json']);
  });

  it('remembers the active room after loading a repo', async () => {
    const repo = await createTempRepo();
    await writeSquadFixture(repo);
    const service = new SquadRoomService();

    await service.getRoom(repo);

    await expect(service.getActiveRoom()).resolves.toMatchObject({
      status: 'ready',
      repoPath: repo,
    });
  });

  it('returns error status for malformed Squad config', async () => {
    const repo = await createTempRepo();
    await mkdir(path.join(repo, '.squad'), { recursive: true });
    await writeFile(path.join(repo, '.squad', 'config.json'), '{"version":"1"}');

    const snapshot = await new SquadRoomService().getRoom(repo);

    expect(snapshot.status).toBe('error');
    expect(snapshot.lastError).toMatch(/numeric version/);
  });

  it('records Squad Room messages with a fake runner', async () => {
    const repo = await createTempRepo();
    const transcriptRoot = await mkdtemp(path.join(os.tmpdir(), 'chamber-squad-transcripts-'));
    await writeSquadFixture(repo);
    const service = new SquadRoomService({
      bridgeRunner: new FakeSquadBridgeRunner(['use the existing team']),
      transcriptRoot,
      now: () => 123,
    });

    const result = await service.send({
      roomId: repo,
      repoPath: repo,
      prompt: 'What should we do?',
    });

    expect(result).toMatchObject({ success: true });
    await expect(service.history(repo)).resolves.toMatchObject([
      {
        roomId: repo,
        role: 'user',
        content: 'What should we do?',
        timestamp: 123,
      },
      {
        roomId: repo,
        role: 'assistant',
        content: 'use the existing team',
      },
    ]);
  });

  it('rejects sends when the selected repo is not ready', async () => {
    const repo = await createTempRepo();
    const service = new SquadRoomService({ bridgeRunner: new FakeSquadBridgeRunner() });

    await expect(service.send({ roomId: repo, repoPath: repo, prompt: 'hello' })).resolves.toEqual({
      success: false,
      reason: 'room-not-ready',
      error: 'Selected repository does not have a ready Squad.',
    });
  });

  it('rejects overlapping sends for the same room', async () => {
    const repo = await createTempRepo();
    await writeSquadFixture(repo);
    const releaseRunner = createReleaseRunner();
    const service = new SquadRoomService({ bridgeRunner: releaseRunner.runner });

    const first = service.send({ roomId: repo, repoPath: repo, prompt: 'first' });
    await releaseRunner.started;

    await expect(service.send({ roomId: repo, repoPath: repo, prompt: 'second' })).resolves.toEqual({
      success: false,
      reason: 'busy',
      error: 'Squad Room already has an active turn.',
    });

    releaseRunner.release();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it('clears transcript history', async () => {
    const repo = await createTempRepo();
    await writeSquadFixture(repo);
    const service = new SquadRoomService({ bridgeRunner: new FakeSquadBridgeRunner(['done']) });
    await service.send({ roomId: repo, repoPath: repo, prompt: 'hello' });

    await service.clear(repo);

    await expect(service.history(repo)).resolves.toEqual([]);
  });
});

describe('resolveRepositoryPath', () => {
  it('rejects relative paths', async () => {
    await expect(resolveRepositoryPath('relative\\repo')).rejects.toThrow(/absolute/);
  });

  it('rejects non-directories', async () => {
    const dir = await createTempRepo();
    const filePath = path.join(dir, 'file.txt');
    await writeFile(filePath, 'not a directory');

    await expect(resolveRepositoryPath(filePath)).rejects.toThrow(/directory/);
  });

  it('rejects .working-memory paths', async () => {
    const root = await createTempRepo();
    const workingMemory = path.join(root, '.working-memory');
    await mkdir(workingMemory);

    await expect(resolveRepositoryPath(workingMemory)).rejects.toThrow(/\.working-memory/);
  });
});

async function createTempRepo(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'chamber-squad-room-'));
}

async function writeSquadFixture(repo: string): Promise<void> {
  const squad = path.join(repo, '.squad');
  await mkdir(path.join(squad, 'sessions'), { recursive: true });
  await writeFile(path.join(squad, 'config.json'), '{"version":1}');
  await writeFile(path.join(squad, 'sessions', 'session-1.json'), '{}');
  await writeFile(path.join(squad, 'team.md'), [
    '# Squad Team',
    '',
    '## Coordinator',
    '',
    '| Name | Role | Notes |',
    '|------|------|-------|',
    '| Squad | Coordinator | Routes work |',
    '',
    '## Members',
    '',
    '| Name | Role | Charter | Status |',
    '|------|------|---------|--------|',
    '| Trinity | Frontend | agents/trinity/charter.md | ready |',
  ].join('\n'));
  await writeFile(path.join(squad, 'routing.md'), [
    '# Work Routing',
    '',
    '## Routing Table',
    '',
    '| Work Type | Route To | Examples |',
    '|-----------|----------|----------|',
    '| Frontend | Trinity | React UI |',
  ].join('\n'));
  await writeFile(path.join(squad, 'decisions.md'), [
    '# Squad Decisions',
    '',
    '## Active Decisions',
    '',
    '### Use React',
    'Keep the renderer native.',
  ].join('\n'));
}

function createReleaseRunner(): { runner: SquadBridgeRunner; started: Promise<void>; release: () => void } {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    started,
    release,
    runner: {
      send: vi.fn(async (request, callbacks) => {
        markStarted();
        await released;
        const message = {
          id: 'message-1',
          roomId: request.roomId,
          turnId: 'turn-1',
          role: 'assistant' as const,
          sender: { kind: 'squad-coordinator' as const, id: 'coordinator', name: 'Squad Coordinator' },
          content: 'done',
          timestamp: 456,
        };
        callbacks.onEvent({ type: 'message-complete', roomId: request.roomId, turnId: 'turn-1', messageId: 'message-1', content: 'done' });
        return { success: true as const, turnId: 'turn-1', message };
      }),
      stop: vi.fn(async () => undefined),
    },
  };
}
