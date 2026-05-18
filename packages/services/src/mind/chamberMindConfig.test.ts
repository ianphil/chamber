import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadChamberMindConfig, CHAMBER_MIND_CONFIG_FILENAME } from './chamberMindConfig';

describe('loadChamberMindConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-mind-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty config when no .chamber.json file is present', () => {
    expect(loadChamberMindConfig(tmpDir)).toEqual({});
  });

  it('reads excludedTools when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: ['shell', 'str_replace'] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({
      excludedTools: ['shell', 'str_replace'],
    });
  });

  it('omits excludedTools when the array is empty so the SDK sees no key', () => {
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: [] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({});
  });

  it('returns empty config for invalid JSON without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME), '{ not valid json');
    expect(loadChamberMindConfig(tmpDir)).toEqual({});
    warn.mockRestore();
  });

  it('rejects an excludedTools entry that is not a string array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(
      path.join(tmpDir, CHAMBER_MIND_CONFIG_FILENAME),
      JSON.stringify({ excludedTools: [1, 2, 3] }),
    );
    expect(loadChamberMindConfig(tmpDir)).toEqual({});
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
    });
  });
});
