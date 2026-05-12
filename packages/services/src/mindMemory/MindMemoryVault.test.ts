import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMindMemoryVault } from './MindMemoryVault';

let mindRoot: string;

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-vault-'));
});

afterEach(() => {
  fs.rmSync(mindRoot, { recursive: true, force: true });
});

describe('MindMemoryVault — root and ensureDir', () => {
  it('exposes an absolute, normalized root under <mindPath>/.working-memory/', () => {
    const vault = createMindMemoryVault(mindRoot);
    expect(path.isAbsolute(vault.root)).toBe(true);
    expect(vault.root).toBe(path.resolve(mindRoot, '.working-memory'));
  });

  it('does not touch the disk on construction', () => {
    createMindMemoryVault(mindRoot);
    expect(fs.existsSync(path.join(mindRoot, '.working-memory'))).toBe(false);
  });

  it('ensureDir is idempotent and creates the working-memory directory', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.ensureDir();
    await vault.ensureDir();
    expect(fs.statSync(vault.root).isDirectory()).toBe(true);
  });
});

describe('MindMemoryVault — read / write / exists', () => {
  it('round-trips read/write for a top-level file', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('memory.md', '# memories\n');
    expect(await vault.read('memory.md')).toBe('# memories\n');
    expect(await vault.exists('memory.md')).toBe(true);
  });

  it('returns null when reading a missing file', async () => {
    const vault = createMindMemoryVault(mindRoot);
    expect(await vault.read('memory.md')).toBeNull();
    expect(await vault.exists('memory.md')).toBe(false);
  });

  it('write is atomic — no .tmp.* files remain after success', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('log.md', 'hello');
    const files = fs.readdirSync(vault.root);
    expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
    expect(files).toContain('log.md');
  });

  it('write replaces existing content atomically', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('rules.md', 'first');
    await vault.write('rules.md', 'second');
    expect(await vault.read('rules.md')).toBe('second');
  });

  it('write creates parent directories under root for nested rel paths', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write(path.join('subdir', 'note.md'), 'nested');
    expect(await vault.read(path.join('subdir', 'note.md'))).toBe('nested');
  });
});

describe('MindMemoryVault — append', () => {
  it('appends to a non-existent file (creating it)', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.append('log.md', 'line1\n');
    expect(await vault.read('log.md')).toBe('line1\n');
  });

  it('appends to existing content', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('log.md', 'a\n');
    await vault.append('log.md', 'b\n');
    expect(await vault.read('log.md')).toBe('a\nb\n');
  });

  it('serializes concurrent appends to the same file (no interleaving / loss)', async () => {
    const vault = createMindMemoryVault(mindRoot);
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i.toString().padStart(3, '0')}\n`);
    await Promise.all(lines.map((line) => vault.append('log.md', line)));
    const content = await vault.read('log.md');
    expect(content).not.toBeNull();
    const sortedLines = (content as string).split('\n').filter(Boolean).sort();
    expect(sortedLines).toEqual(lines.map((l) => l.trimEnd()).sort());
    expect((content as string).length).toBe(lines.reduce((sum, l) => sum + l.length, 0));
  });
});

describe('MindMemoryVault — listFiles', () => {
  it('lists top-level files only', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('memory.md', 'm');
    await vault.write('rules.md', 'r');
    await vault.write('log.md', 'l');
    const list = await vault.listFiles();
    expect(list.sort()).toEqual(['log.md', 'memory.md', 'rules.md']);
  });

  it('returns an empty list before ensureDir / when root does not exist', async () => {
    const vault = createMindMemoryVault(mindRoot);
    expect(await vault.listFiles()).toEqual([]);
  });

  it('excludes the .state/ subdirectory and its contents', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('memory.md', 'm');
    fs.mkdirSync(path.join(vault.root, '.state'), { recursive: true });
    fs.writeFileSync(path.join(vault.root, '.state', 'dream.db'), 'x');
    const list = await vault.listFiles();
    expect(list).toContain('memory.md');
    expect(list).not.toContain('.state');
    expect(list).not.toContain('dream.db');
  });

  it('excludes the archive/ subdirectory', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('memory.md', 'm');
    fs.mkdirSync(path.join(vault.root, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(vault.root, 'archive', 'something.md'), 'a');
    const list = await vault.listFiles();
    expect(list).toContain('memory.md');
    expect(list).not.toContain('archive');
    expect(list).not.toContain('something.md');
  });

  it('excludes nested subdirectory contents (only top-level files)', async () => {
    const vault = createMindMemoryVault(mindRoot);
    await vault.write('memory.md', 'm');
    fs.mkdirSync(path.join(vault.root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(vault.root, 'nested', 'inner.md'), 'i');
    const list = await vault.listFiles();
    expect(list).toEqual(['memory.md']);
  });
});

describe('MindMemoryVault — path traversal guard', () => {
  const traversalCases: Array<{ name: string; relPath: string }> = [
    { name: 'parent reference (posix)', relPath: '../escape.md' },
    { name: 'parent reference (windows)', relPath: '..\\escape.md' },
    { name: 'nested parent reference', relPath: 'a/../../escape.md' },
    { name: 'absolute posix path', relPath: '/etc/passwd' },
    { name: 'absolute windows path', relPath: 'C:\\Windows\\System32\\config' },
    { name: 'UNC path', relPath: '\\\\server\\share\\file' },
    { name: 'embedded null byte', relPath: 'good\u0000bad.md' },
    { name: 'just ..', relPath: '..' },
    { name: 'empty string', relPath: '' },
  ];

  for (const { name, relPath } of traversalCases) {
    it(`read rejects ${name}`, async () => {
      const vault = createMindMemoryVault(mindRoot);
      await expect(vault.read(relPath)).rejects.toThrow(/path|escape|invalid/i);
    });

    it(`write rejects ${name}`, async () => {
      const vault = createMindMemoryVault(mindRoot);
      await expect(vault.write(relPath, 'x')).rejects.toThrow(/path|escape|invalid/i);
    });

    it(`append rejects ${name}`, async () => {
      const vault = createMindMemoryVault(mindRoot);
      await expect(vault.append(relPath, 'x')).rejects.toThrow(/path|escape|invalid/i);
    });

    it(`exists rejects ${name}`, async () => {
      const vault = createMindMemoryVault(mindRoot);
      await expect(vault.exists(relPath)).rejects.toThrow(/path|escape|invalid/i);
    });
  }
});

describe('MindMemoryVault — mind boundary isolation', () => {
  it('two vaults rooted at sibling paths cannot read each other via ..', async () => {
    const otherMind = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-vault-other-'));
    try {
      const vaultA = createMindMemoryVault(mindRoot);
      const vaultB = createMindMemoryVault(otherMind);

      await vaultA.write('memory.md', 'A-only');
      await vaultB.write('memory.md', 'B-only');

      expect(await vaultA.read('memory.md')).toBe('A-only');
      expect(await vaultB.read('memory.md')).toBe('B-only');

      const otherName = path.basename(otherMind);
      const escape = path.join('..', '..', otherName, '.working-memory', 'memory.md');
      await expect(vaultA.read(escape)).rejects.toThrow(/path|escape/i);

      expect(await vaultA.read('memory.md')).toBe('A-only');
      expect(await vaultB.read('memory.md')).toBe('B-only');
    } finally {
      fs.rmSync(otherMind, { recursive: true, force: true });
    }
  });

  it('write under mindA does not produce any file under mindB', async () => {
    const otherMind = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-vault-other-'));
    try {
      const vaultA = createMindMemoryVault(mindRoot);
      const vaultB = createMindMemoryVault(otherMind);
      await vaultA.write('memory.md', 'A');
      await vaultA.write('rules.md', 'A-rules');

      const bRootExists = fs.existsSync(vaultB.root);
      if (bRootExists) {
        expect(fs.readdirSync(vaultB.root)).toEqual([]);
      }

      const aFiles = await fsp.readdir(vaultA.root);
      expect(aFiles.sort()).toEqual(['memory.md', 'rules.md']);
    } finally {
      fs.rmSync(otherMind, { recursive: true, force: true });
    }
  });
});
