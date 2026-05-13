import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../../scripts/lib/ensure-native-abi.cjs') as {
  TARGETS: readonly string[];
  DEFAULT_SENTINEL_PATH: string;
  readSentinel: (p?: string) => string | null;
  decideAction: (input: { target: string; current: string | null }) => 'noop' | 'rebuild';
  writeSentinel: (target: string, p?: string) => void;
  rebuildCommand: (target: string) => string;
  rebuild: (target: string, runner?: (cmd: string) => void) => void;
};

describe('ensure-native-abi guard', () => {
  let tmpDir: string;
  let sentinelPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-abi-test-'));
    sentinelPath = path.join(tmpDir, 'build', 'Release', '.abi-target');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('TARGETS', () => {
    it('is locked to node and electron only', () => {
      expect([...lib.TARGETS]).toEqual(['node', 'electron']);
    });
  });

  describe('decideAction', () => {
    it('returns "noop" when current matches target', () => {
      expect(lib.decideAction({ target: 'node', current: 'node' })).toBe('noop');
      expect(lib.decideAction({ target: 'electron', current: 'electron' })).toBe('noop');
    });

    it('returns "rebuild" when current differs from target', () => {
      expect(lib.decideAction({ target: 'node', current: 'electron' })).toBe('rebuild');
      expect(lib.decideAction({ target: 'electron', current: 'node' })).toBe('rebuild');
    });

    it('returns "rebuild" when no sentinel exists yet (current is null)', () => {
      expect(lib.decideAction({ target: 'node', current: null })).toBe('rebuild');
      expect(lib.decideAction({ target: 'electron', current: null })).toBe('rebuild');
    });

    it('throws on unknown target rather than silently skipping', () => {
      expect(() => lib.decideAction({ target: 'wasm', current: 'node' })).toThrow(/unknown target/);
      expect(() => lib.decideAction({ target: '', current: 'node' })).toThrow(/unknown target/);
    });
  });

  describe('readSentinel', () => {
    it('returns null when the sentinel file does not exist', () => {
      expect(lib.readSentinel(sentinelPath)).toBeNull();
    });

    it('returns the trimmed sentinel contents when present', () => {
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, 'electron\n');
      expect(lib.readSentinel(sentinelPath)).toBe('electron');
    });

    it('returns null when the sentinel directory is unreadable / missing parents', () => {
      const deepMissing = path.join(tmpDir, 'never', 'made', '.abi-target');
      expect(lib.readSentinel(deepMissing)).toBeNull();
    });
  });

  describe('writeSentinel', () => {
    it('creates parent directories and writes the target with a trailing newline', () => {
      lib.writeSentinel('node', sentinelPath);
      const raw = fs.readFileSync(sentinelPath, 'utf8');
      expect(raw).toBe('node\n');
    });

    it('round-trips with readSentinel', () => {
      lib.writeSentinel('electron', sentinelPath);
      expect(lib.readSentinel(sentinelPath)).toBe('electron');
    });

    it('refuses to write an unknown target', () => {
      expect(() => lib.writeSentinel('wasm', sentinelPath)).toThrow(/unknown target/);
      expect(fs.existsSync(sentinelPath)).toBe(false);
    });

    it('overwrites an existing sentinel rather than appending', () => {
      lib.writeSentinel('node', sentinelPath);
      lib.writeSentinel('electron', sentinelPath);
      expect(lib.readSentinel(sentinelPath)).toBe('electron');
    });
  });

  describe('rebuildCommand', () => {
    it('uses `npm rebuild better-sqlite3` for the node target', () => {
      expect(lib.rebuildCommand('node')).toBe('npm rebuild better-sqlite3');
    });

    it('uses electron-rebuild scoped to better-sqlite3 for the electron target', () => {
      const cmd = lib.rebuildCommand('electron');
      expect(cmd).toContain('electron-rebuild');
      expect(cmd).toContain('better-sqlite3');
      expect(cmd).toContain('-f');
      expect(cmd).toContain('-w better-sqlite3');
    });

    it('throws on unknown target', () => {
      expect(() => lib.rebuildCommand('wasm')).toThrow(/unknown target/);
    });
  });

  describe('rebuild', () => {
    it('invokes the runner with the resolved command for node', () => {
      const calls: string[] = [];
      lib.rebuild('node', (cmd: string) => calls.push(cmd));
      expect(calls).toEqual([lib.rebuildCommand('node')]);
    });

    it('invokes the runner with the resolved command for electron', () => {
      const calls: string[] = [];
      lib.rebuild('electron', (cmd: string) => calls.push(cmd));
      expect(calls).toEqual([lib.rebuildCommand('electron')]);
    });

    it('propagates runner failures so the CLI can exit non-zero', () => {
      expect(() =>
        lib.rebuild('node', () => {
          throw new Error('toolchain missing');
        }),
      ).toThrow(/toolchain missing/);
    });
  });

  describe('integration: full guard sequence', () => {
    it('rebuilds on first run, then noops on the second run with the same target', () => {
      // First run: no sentinel yet → rebuild path
      const first = lib.decideAction({ target: 'node', current: lib.readSentinel(sentinelPath) });
      expect(first).toBe('rebuild');
      const calls: string[] = [];
      lib.rebuild('node', (cmd) => calls.push(cmd));
      lib.writeSentinel('node', sentinelPath);

      // Second run: sentinel matches → noop, no rebuild invoked
      const second = lib.decideAction({ target: 'node', current: lib.readSentinel(sentinelPath) });
      expect(second).toBe('noop');
      expect(calls).toHaveLength(1);
    });

    it('rebuilds when switching target from node → electron', () => {
      lib.writeSentinel('node', sentinelPath);
      const action = lib.decideAction({
        target: 'electron',
        current: lib.readSentinel(sentinelPath),
      });
      expect(action).toBe('rebuild');
    });
  });
});
