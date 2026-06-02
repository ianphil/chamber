import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../../scripts/lib/ensure-native-abi.cjs') as {
  TARGETS: readonly string[];
  DEFAULT_SENTINEL_PATH: string;
  readSentinel: (p?: string) => string | null;
  decideAction: (input: {
    target: string;
    current: string | null;
    moduleVersion: string;
  }) => 'noop' | 'rebuild';
  writeSentinel: (input: { target: string; moduleVersion: string }, p?: string) => void;
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
    it('returns "noop" when current matches target AND module ABI version', () => {
      expect(
        lib.decideAction({ target: 'node', current: 'node:137', moduleVersion: '137' }),
      ).toBe('noop');
      expect(
        lib.decideAction({ target: 'electron', current: 'electron:125', moduleVersion: '125' }),
      ).toBe('noop');
    });

    it('returns "rebuild" when target matches but module ABI version differs', () => {
      // The exact bug C-1 caught: Node 22→24 keeps target='node' but flips MODULE_VERSION.
      expect(
        lib.decideAction({ target: 'node', current: 'node:145', moduleVersion: '137' }),
      ).toBe('rebuild');
      expect(
        lib.decideAction({ target: 'electron', current: 'electron:125', moduleVersion: '127' }),
      ).toBe('rebuild');
    });

    it('returns "rebuild" on a legacy single-token sentinel (pre-ABI format)', () => {
      // A sentinel written by an older version of this script has no `:NNN` suffix.
      // We must rebuild rather than trust it — we cannot prove the ABI matches.
      expect(
        lib.decideAction({ target: 'node', current: 'node', moduleVersion: '137' }),
      ).toBe('rebuild');
      expect(
        lib.decideAction({ target: 'electron', current: 'electron', moduleVersion: '125' }),
      ).toBe('rebuild');
    });

    it('returns "rebuild" when the framework target differs (even with matching ABI)', () => {
      expect(
        lib.decideAction({ target: 'node', current: 'electron:137', moduleVersion: '137' }),
      ).toBe('rebuild');
      expect(
        lib.decideAction({ target: 'electron', current: 'node:125', moduleVersion: '125' }),
      ).toBe('rebuild');
    });

    it('returns "rebuild" when no sentinel exists yet (current is null)', () => {
      expect(
        lib.decideAction({ target: 'node', current: null, moduleVersion: '137' }),
      ).toBe('rebuild');
      expect(
        lib.decideAction({ target: 'electron', current: null, moduleVersion: '125' }),
      ).toBe('rebuild');
    });

    it('throws on unknown target rather than silently skipping', () => {
      expect(() =>
        lib.decideAction({ target: 'wasm', current: 'node:137', moduleVersion: '137' }),
      ).toThrow(/unknown target/);
      expect(() =>
        lib.decideAction({ target: '', current: 'node:137', moduleVersion: '137' }),
      ).toThrow(/unknown target/);
    });

    it('throws on missing or malformed moduleVersion', () => {
      // A bad moduleVersion would corrupt the sentinel — fail loud rather than write garbage.
      expect(() =>
        lib.decideAction({
          target: 'node',
          current: 'node:137',
          moduleVersion: '',
        }),
      ).toThrow(/moduleVersion/);
      expect(() =>
        lib.decideAction({
          target: 'node',
          current: 'node:137',
          moduleVersion: 'undefined',
        }),
      ).toThrow(/moduleVersion/);
      expect(() =>
        lib.decideAction({
          target: 'node',
          current: 'node:137',
          // @ts-expect-error: deliberately wrong type to test runtime guard
          moduleVersion: 137,
        }),
      ).toThrow(/moduleVersion/);
    });
  });

  describe('readSentinel', () => {
    it('returns null when the sentinel file does not exist', () => {
      expect(lib.readSentinel(sentinelPath)).toBeNull();
    });

    it('returns the trimmed sentinel contents when present', () => {
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, 'electron:125\n');
      expect(lib.readSentinel(sentinelPath)).toBe('electron:125');
    });

    it('returns a legacy single-token sentinel verbatim (decideAction handles rejection)', () => {
      // readSentinel stays a dumb file reader; semantic interpretation belongs to decideAction.
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, 'node\n');
      expect(lib.readSentinel(sentinelPath)).toBe('node');
    });

    it('returns null when the sentinel directory is unreadable / missing parents', () => {
      const deepMissing = path.join(tmpDir, 'never', 'made', '.abi-target');
      expect(lib.readSentinel(deepMissing)).toBeNull();
    });
  });

  describe('writeSentinel', () => {
    it('writes ${target}:${moduleVersion} with a trailing newline, creating parents', () => {
      lib.writeSentinel({ target: 'node', moduleVersion: '137' }, sentinelPath);
      const raw = fs.readFileSync(sentinelPath, 'utf8');
      expect(raw).toBe('node:137\n');
    });

    it('round-trips with readSentinel for both targets', () => {
      lib.writeSentinel({ target: 'electron', moduleVersion: '125' }, sentinelPath);
      expect(lib.readSentinel(sentinelPath)).toBe('electron:125');
    });

    it('refuses to write an unknown target', () => {
      expect(() =>
        lib.writeSentinel({ target: 'wasm', moduleVersion: '137' }, sentinelPath),
      ).toThrow(/unknown target/);
      expect(fs.existsSync(sentinelPath)).toBe(false);
    });

    it('refuses to write a missing or malformed moduleVersion', () => {
      expect(() =>
        lib.writeSentinel({ target: 'node', moduleVersion: '' }, sentinelPath),
      ).toThrow(/moduleVersion/);
      expect(() =>
        lib.writeSentinel({ target: 'node', moduleVersion: 'NaN' }, sentinelPath),
      ).toThrow(/moduleVersion/);
      expect(fs.existsSync(sentinelPath)).toBe(false);
    });

    it('overwrites an existing sentinel rather than appending', () => {
      lib.writeSentinel({ target: 'node', moduleVersion: '137' }, sentinelPath);
      lib.writeSentinel({ target: 'electron', moduleVersion: '125' }, sentinelPath);
      expect(lib.readSentinel(sentinelPath)).toBe('electron:125');
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
    it('rebuilds on first run, then noops on the second run with the same target+ABI', () => {
      // First run: no sentinel yet → rebuild path
      const first = lib.decideAction({
        target: 'node',
        current: lib.readSentinel(sentinelPath),
        moduleVersion: '137',
      });
      expect(first).toBe('rebuild');
      const calls: string[] = [];
      lib.rebuild('node', (cmd) => calls.push(cmd));
      lib.writeSentinel({ target: 'node', moduleVersion: '137' }, sentinelPath);

      // Second run: sentinel matches → noop, no rebuild invoked
      const second = lib.decideAction({
        target: 'node',
        current: lib.readSentinel(sentinelPath),
        moduleVersion: '137',
      });
      expect(second).toBe('noop');
      expect(calls).toHaveLength(1);
    });

    it('rebuilds when switching target from node → electron', () => {
      lib.writeSentinel({ target: 'node', moduleVersion: '137' }, sentinelPath);
      const action = lib.decideAction({
        target: 'electron',
        current: lib.readSentinel(sentinelPath),
        moduleVersion: '125',
      });
      expect(action).toBe('rebuild');
    });

    it('rebuilds when Node ABI shifts under the same target (the C-1 bug)', () => {
      // Simulates: binary was built on Node 23 (MODULE_VERSION 145), developer upgraded
      // to Node 24 (MODULE_VERSION 137). Old guard silently said noop. New guard rebuilds.
      lib.writeSentinel({ target: 'node', moduleVersion: '145' }, sentinelPath);
      const action = lib.decideAction({
        target: 'node',
        current: lib.readSentinel(sentinelPath),
        moduleVersion: '137',
      });
      expect(action).toBe('rebuild');
    });

    it('treats a legacy single-token sentinel as a rebuild signal', () => {
      // Older sentinel left by pre-fix versions of the guard. Force a one-time rebuild
      // so the new format is written and future runs can short-circuit.
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, 'node\n');
      const action = lib.decideAction({
        target: 'node',
        current: lib.readSentinel(sentinelPath),
        moduleVersion: '137',
      });
      expect(action).toBe('rebuild');
    });
  });
});
