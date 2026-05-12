import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMindArchiveStore } from './MindArchiveStore';
import { createMindMemoryVault } from './MindMemoryVault';

let mindRoot: string;

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-archive-'));
});

afterEach(() => {
  fs.rmSync(mindRoot, { recursive: true, force: true });
});

describe('MindArchiveStore — root', () => {
  it('roots itself at <mindPath>/.working-memory/archive/', () => {
    const archive = createMindArchiveStore(mindRoot);
    expect(archive.root).toBe(path.resolve(mindRoot, '.working-memory', 'archive'));
    expect(path.isAbsolute(archive.root)).toBe(true);
  });

  it('does not touch disk on construction', () => {
    createMindArchiveStore(mindRoot);
    expect(fs.existsSync(path.join(mindRoot, '.working-memory'))).toBe(false);
  });
});

describe('MindArchiveStore — writeConsolidated', () => {
  it('writes to archive/consolidated/<ISO>--<turnId>.md and returns the relPath', async () => {
    const archive = createMindArchiveStore(mindRoot);
    const relPath = await archive.writeConsolidated({
      turnId: '11111111-1111-4111-8111-111111111111',
      timestamp: '2026-05-12T12:34:56Z',
      content: 'consolidated body',
    });
    // `:` is replaced with `-` for Windows filename portability; documented in
    // MindArchiveStore.ts. Input contract remains ISO-8601 UTC.
    expect(relPath).toBe(
      path.join('consolidated', '2026-05-12T12-34-56Z--11111111-1111-4111-8111-111111111111.md'),
    );
    const abs = path.join(archive.root, relPath);
    expect(fs.readFileSync(abs, 'utf-8')).toBe('consolidated body');
  });

  it('auto-creates the consolidated/ subdirectory', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await archive.writeConsolidated({
      turnId: 'tid-1',
      timestamp: '2026-05-12T00:00:00Z',
      content: 'x',
    });
    expect(fs.statSync(path.join(archive.root, 'consolidated')).isDirectory()).toBe(true);
  });

  it('rejects a turnId containing path separators', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await expect(
      archive.writeConsolidated({
        turnId: '../escape',
        timestamp: '2026-05-12T00:00:00Z',
        content: 'x',
      }),
    ).rejects.toThrow(/turn|path|escape|invalid/i);
  });

  it('rejects a timestamp containing path separators', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await expect(
      archive.writeConsolidated({
        turnId: 'tid-1',
        timestamp: '2026/05/12',
        content: 'x',
      }),
    ).rejects.toThrow(/timestamp|path|invalid/i);
  });
});

describe('MindArchiveStore — writeWeekly / writeMonthly', () => {
  it('writes weekly/<key>.md', async () => {
    const archive = createMindArchiveStore(mindRoot);
    const relPath = await archive.writeWeekly('2026-W19', 'weekly body');
    expect(relPath).toBe(path.join('weekly', '2026-W19.md'));
    expect(fs.readFileSync(path.join(archive.root, relPath), 'utf-8')).toBe('weekly body');
  });

  it('writes monthly/<key>.md', async () => {
    const archive = createMindArchiveStore(mindRoot);
    const relPath = await archive.writeMonthly('2026-05', 'monthly body');
    expect(relPath).toBe(path.join('monthly', '2026-05.md'));
    expect(fs.readFileSync(path.join(archive.root, relPath), 'utf-8')).toBe('monthly body');
  });

  it('weekly write replaces existing content atomically', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await archive.writeWeekly('2026-W19', 'first');
    await archive.writeWeekly('2026-W19', 'second');
    expect(fs.readFileSync(path.join(archive.root, 'weekly', '2026-W19.md'), 'utf-8')).toBe('second');
    const dirEntries = fs.readdirSync(path.join(archive.root, 'weekly'));
    expect(dirEntries.some((f) => f.includes('.tmp.'))).toBe(false);
  });

  it('rejects weekly keys containing path separators', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await expect(archive.writeWeekly('../escape', 'x')).rejects.toThrow(/key|path|invalid/i);
    await expect(archive.writeWeekly('2026/W19', 'x')).rejects.toThrow(/key|path|invalid/i);
  });

  it('rejects monthly keys containing path separators', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await expect(archive.writeMonthly('../escape', 'x')).rejects.toThrow(/key|path|invalid/i);
    await expect(archive.writeMonthly('2026\\05', 'x')).rejects.toThrow(/key|path|invalid/i);
  });
});

describe('MindArchiveStore — list methods', () => {
  it('listConsolidated returns only files under consolidated/', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await archive.writeConsolidated({
      turnId: 't1',
      timestamp: '2026-05-12T00:00:00Z',
      content: 'a',
    });
    await archive.writeConsolidated({
      turnId: 't2',
      timestamp: '2026-05-12T01:00:00Z',
      content: 'b',
    });
    await archive.writeWeekly('2026-W19', 'w');
    const list = await archive.listConsolidated();
    expect(list.sort()).toEqual([
      '2026-05-12T00-00-00Z--t1.md',
      '2026-05-12T01-00-00Z--t2.md',
    ]);
  });

  it('listWeekly returns only files under weekly/', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await archive.writeWeekly('2026-W19', 'a');
    await archive.writeWeekly('2026-W20', 'b');
    await archive.writeMonthly('2026-05', 'm');
    const list = await archive.listWeekly();
    expect(list.sort()).toEqual(['2026-W19.md', '2026-W20.md']);
  });

  it('listMonthly returns only files under monthly/', async () => {
    const archive = createMindArchiveStore(mindRoot);
    await archive.writeMonthly('2026-04', 'a');
    await archive.writeMonthly('2026-05', 'b');
    const list = await archive.listMonthly();
    expect(list.sort()).toEqual(['2026-04.md', '2026-05.md']);
  });

  it('list methods return [] when their directory does not exist yet', async () => {
    const archive = createMindArchiveStore(mindRoot);
    expect(await archive.listConsolidated()).toEqual([]);
    expect(await archive.listWeekly()).toEqual([]);
    expect(await archive.listMonthly()).toEqual([]);
  });
});

describe('MindArchiveStore — interaction with MindMemoryVault', () => {
  it('archive writes never appear in vault.listFiles()', async () => {
    const vault = createMindMemoryVault(mindRoot);
    const archive = createMindArchiveStore(mindRoot);
    await vault.write('memory.md', 'm');
    await archive.writeConsolidated({
      turnId: 't1',
      timestamp: '2026-05-12T00:00:00Z',
      content: 'c',
    });
    await archive.writeWeekly('2026-W19', 'w');
    await archive.writeMonthly('2026-05', 'mo');
    expect(await vault.listFiles()).toEqual(['memory.md']);
  });
});
