import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadChamberMindConfig,
  patchChamberMindConfig,
  CHAMBER_MIND_CONFIG_FILENAME,
  DEFAULT_WORKING_MEMORY_CONSOLIDATION,
} from './chamberMindConfig';

const defaultWorkingMemory = () => ({
  consolidation: { ...DEFAULT_WORKING_MEMORY_CONSOLIDATION },
});

describe('loadChamberMindConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mind-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns workingMemory defaults when no .chamber.json file is present', () => {
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      workingMemory: defaultWorkingMemory(),
    });
  });

  it('reads excludedTools when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: ['shell', 'str_replace'] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      excludedTools: ['shell', 'str_replace'],
      workingMemory: defaultWorkingMemory(),
    });
  });

  it('omits excludedTools when the array is empty so the SDK sees no key', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: [] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      workingMemory: defaultWorkingMemory(),
    });
  });

  it('returns defaults for invalid JSON without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), '{ not valid json');
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      workingMemory: defaultWorkingMemory(),
    });
    warn.mockRestore();
  });

  it('rejects an excludedTools entry that is not a string array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: [1, 2, 3] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      workingMemory: defaultWorkingMemory(),
    });
    warn.mockRestore();
  });

  it('ignores extra unknown keys to stay forward-compatible', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({
        excludedTools: ['shell'],
        somethingFromAFutureVersion: { ignored: true },
      }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      excludedTools: ['shell'],
      workingMemory: defaultWorkingMemory(),
    });
  });
});

describe('chamberMindConfig — workingMemory.consolidation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mind-config-wm-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(value: unknown): void {
    fs.writeFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), JSON.stringify(value));
  }

  describe('defaults', () => {
    it('parsing an empty config yields the consolidation defaults', () => {
      writeConfig({});
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.enabled).toBe(false);
      expect(cfg.workingMemory.consolidation.cron).toBe('0 3 * * *');
      expect(cfg.workingMemory.consolidation.lastKTurns).toBe(10);
      expect(cfg.workingMemory.consolidation.perTurnMaxBytes).toBe(2048);
      expect(cfg.workingMemory.consolidation.memoryMaxBytes).toBe(8192);
    });

    it('exposes the defaults as a frozen constant for downstream consumers', () => {
      expect(DEFAULT_WORKING_MEMORY_CONSOLIDATION).toEqual({
        enabled: false,
        cron: '0 3 * * *',
        lastKTurns: 10,
        perTurnMaxBytes: 2048,
        memoryMaxBytes: 8192,
      });
    });
  });

  describe('override', () => {
    it('returns user-provided values verbatim when all five fields are set', () => {
      writeConfig({
        workingMemory: {
          consolidation: {
            enabled: true,
            cron: '*/15 * * * *',
            lastKTurns: 25,
            perTurnMaxBytes: 4096,
            memoryMaxBytes: 16384,
          },
        },
      });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation).toEqual({
        enabled: true,
        cron: '*/15 * * * *',
        lastKTurns: 25,
        perTurnMaxBytes: 4096,
        memoryMaxBytes: 16384,
      });
    });

    it('honors the opt-in path when only enabled: true is set', () => {
      writeConfig({ workingMemory: { consolidation: { enabled: true } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.enabled).toBe(true);
      expect(cfg.workingMemory.consolidation.cron).toBe('0 3 * * *');
      expect(cfg.workingMemory.consolidation.lastKTurns).toBe(10);
      expect(cfg.workingMemory.consolidation.perTurnMaxBytes).toBe(2048);
      expect(cfg.workingMemory.consolidation.memoryMaxBytes).toBe(8192);
    });
  });

  describe('invalid → warn + ignore', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    function expectWarnedAbout(field: string): void {
      const matched = warn.mock.calls.some((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes(`workingMemory.consolidation.${field}`)),
      );
      expect(matched, `expected a warning mentioning workingMemory.consolidation.${field}`).toBe(true);
    }

    it('falls back to default false when enabled is a string', () => {
      writeConfig({ workingMemory: { consolidation: { enabled: 'yes' } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.enabled).toBe(false);
      expectWarnedAbout('enabled');
    });

    it('falls back to default cron when cron is a number', () => {
      writeConfig({ workingMemory: { consolidation: { cron: 42 } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.cron).toBe('0 3 * * *');
      expectWarnedAbout('cron');
    });

    it('falls back to default lastKTurns when value is negative', () => {
      writeConfig({ workingMemory: { consolidation: { lastKTurns: -5 } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.lastKTurns).toBe(10);
      expectWarnedAbout('lastKTurns');
    });

    it('falls back to default memoryMaxBytes when value is zero', () => {
      writeConfig({ workingMemory: { consolidation: { memoryMaxBytes: 0 } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.memoryMaxBytes).toBe(8192);
      expectWarnedAbout('memoryMaxBytes');
    });

    it('falls back to default perTurnMaxBytes when value is a non-integer float', () => {
      writeConfig({ workingMemory: { consolidation: { perTurnMaxBytes: 12.5 } } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.perTurnMaxBytes).toBe(2048);
      expectWarnedAbout('perTurnMaxBytes');
    });

    it('keeps valid sibling fields when one field is invalid', () => {
      writeConfig({
        workingMemory: {
          consolidation: {
            enabled: true,
            cron: 42,
            lastKTurns: 20,
          },
        },
      });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation.enabled).toBe(true);
      expect(cfg.workingMemory.consolidation.cron).toBe('0 3 * * *');
      expect(cfg.workingMemory.consolidation.lastKTurns).toBe(20);
      expectWarnedAbout('cron');
    });

    it('falls back to defaults when workingMemory.consolidation is not an object', () => {
      writeConfig({ workingMemory: { consolidation: 'nope' } });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation).toEqual({ ...DEFAULT_WORKING_MEMORY_CONSOLIDATION });
      const matched = warn.mock.calls.some((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('workingMemory.consolidation')),
      );
      expect(matched).toBe(true);
    });

    it('falls back to defaults when workingMemory itself is not an object', () => {
      writeConfig({ workingMemory: 'nope' });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation).toEqual({ ...DEFAULT_WORKING_MEMORY_CONSOLIDATION });
      const matched = warn.mock.calls.some((call: unknown[]) =>
        call.some((arg: unknown) => typeof arg === 'string' && arg.includes('workingMemory')),
      );
      expect(matched).toBe(true);
    });
  });

  describe('backward compat', () => {
    it('a pre-Phase-4 config with no workingMemory key returns full consolidation defaults', () => {
      writeConfig({ excludedTools: ['shell'] });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation).toEqual({ ...DEFAULT_WORKING_MEMORY_CONSOLIDATION });
    });

    it('preserves existing top-level fields byte-identically when adding consolidation defaults', () => {
      const baseline = { excludedTools: ['shell', 'str_replace'] };
      writeConfig(baseline);
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.excludedTools).toEqual(baseline.excludedTools);
      expect(cfg.workingMemory.consolidation).toEqual({ ...DEFAULT_WORKING_MEMORY_CONSOLIDATION });
    });

    it('an empty workingMemory: {} block returns full consolidation defaults', () => {
      writeConfig({ workingMemory: {} });
      const cfg = loadChamberMindConfig(tmpDir);
      expect(cfg.workingMemory.consolidation).toEqual({ ...DEFAULT_WORKING_MEMORY_CONSOLIDATION });
    });
  });

  describe('idempotence', () => {
    it('re-loading the same config yields identical results', () => {
      writeConfig({
        excludedTools: ['shell'],
        workingMemory: {
          consolidation: {
            enabled: true,
            lastKTurns: 7,
          },
        },
      });
      const first = loadChamberMindConfig(tmpDir);
      const second = loadChamberMindConfig(tmpDir);
      expect(second).toEqual(first);
    });

    it('mutating the returned consolidation does not affect future loads', () => {
      writeConfig({});
      const first = loadChamberMindConfig(tmpDir);
      first.workingMemory.consolidation.enabled = true;
      first.workingMemory.consolidation.lastKTurns = 99;
      const second = loadChamberMindConfig(tmpDir);
      expect(second.workingMemory.consolidation.enabled).toBe(false);
      expect(second.workingMemory.consolidation.lastKTurns).toBe(10);
    });
  });
});

describe('patchChamberMindConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mind-config-patch-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the .chamber.json file when it does not yet exist and applies the patch', () => {
    patchChamberMindConfig(tmpDir, {
      workingMemory: { consolidation: { enabled: true } },
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), 'utf-8'));
    expect(onDisk).toEqual({
      workingMemory: { consolidation: { enabled: true } },
    });
  });

  it('deep-merges into an existing workingMemory.consolidation block', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({
        workingMemory: {
          consolidation: { enabled: false, cron: '*/5 * * * *', lastKTurns: 5 },
        },
      }, null, 2) + '\n',
    );

    patchChamberMindConfig(tmpDir, {
      workingMemory: { consolidation: { enabled: true } },
    });

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), 'utf-8'));
    expect(onDisk.workingMemory.consolidation).toEqual({
      enabled: true,
      cron: '*/5 * * * *',
      lastKTurns: 5,
    });
  });

  it('preserves existing top-level passthrough fields like excludedTools', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({
        excludedTools: ['shell', 'str_replace'],
        somethingFromAFutureVersion: { keepMe: true },
      }, null, 2) + '\n',
    );

    patchChamberMindConfig(tmpDir, {
      workingMemory: { consolidation: { enabled: true } },
    });

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), 'utf-8'));
    expect(onDisk.excludedTools).toEqual(['shell', 'str_replace']);
    expect(onDisk.somethingFromAFutureVersion).toEqual({ keepMe: true });
    expect(onDisk.workingMemory.consolidation.enabled).toBe(true);
  });

  it('writes pretty-printed JSON ending with a newline', () => {
    patchChamberMindConfig(tmpDir, {
      workingMemory: { consolidation: { enabled: true } },
    });
    const raw = fs.readFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  ');
  });

  it('leaves the original .chamber.json byte-identical when the rename step fails', () => {
    // Trigger a real OS-level rename failure without monkey-patching fs
    // (which is impossible for ESM-imported `node:fs.renameSync`). We make
    // `.chamber.json` a non-empty directory so:
    //   * readRawChamberConfig() sees existsSync=true but readFileSync throws
    //     (EISDIR) → caught → returns {}
    //   * writeFileSync(tmpPath) succeeds (tmp lives next to the dir)
    //   * renameSync(tmp, dir) fails → caught → tmp removed → rethrow
    const filePath = path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME);
    fs.mkdirSync(filePath);
    const sentinelPath = path.join(filePath, 'marker.txt');
    fs.writeFileSync(sentinelPath, 'untouched');

    expect(() => patchChamberMindConfig(tmpDir, {
      workingMemory: { consolidation: { enabled: true } },
    })).toThrow();

    expect(fs.statSync(filePath).isDirectory()).toBe(true);
    expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('untouched');
    const lingering = fs.readdirSync(tmpDir).filter((entry) => entry.endsWith('.tmp'));
    expect(lingering).toEqual([]);
  });
});
