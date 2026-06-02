import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateScriptPath, ScriptPathValidationError } from './validateScriptPath';

let mindPath: string;

beforeEach(() => {
  mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-validate-'));
  fs.mkdirSync(path.join(mindPath, '.chamber', 'automation'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(mindPath, { recursive: true, force: true });
});

function writeScript(rel: string, contents = '// ok'): string {
  const full = path.join(mindPath, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return rel;
}

describe('validateScriptPath', () => {
  it('returns the realpath of a valid script', () => {
    writeScript('.chamber/automation/daily.ts');
    const resolved = validateScriptPath(mindPath, '.chamber/automation/daily.ts');
    expect(resolved).toBe(fs.realpathSync(path.join(mindPath, '.chamber/automation/daily.ts')));
  });

  it('rejects empty input', () => {
    expect(() => validateScriptPath(mindPath, '')).toThrow(ScriptPathValidationError);
  });

  it('rejects absolute paths', () => {
    expect(() => validateScriptPath(mindPath, '/etc/passwd.ts')).toThrow(/mind-relative/);
  });

  it('rejects parent traversal segments', () => {
    expect(() => validateScriptPath(mindPath, '.chamber/automation/../../etc/x.ts')).toThrow(/\.\./);
  });

  it('rejects non-.ts files', () => {
    writeScript('.chamber/automation/script.js');
    expect(() => validateScriptPath(mindPath, '.chamber/automation/script.js')).toThrow(/\.ts/);
  });

  it('rejects paths outside .chamber/automation/', () => {
    writeScript('elsewhere/x.ts');
    expect(() => validateScriptPath(mindPath, 'elsewhere/x.ts')).toThrow(/\.chamber\/automation/);
  });

  it('rejects missing files', () => {
    expect(() => validateScriptPath(mindPath, '.chamber/automation/missing.ts')).toThrow(/does not exist/);
  });

  it('rejects symlinks that escape the mind root', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-outside-'));
    try {
      const outsideScript = path.join(outsideDir, 'evil.ts');
      fs.writeFileSync(outsideScript, '// evil');
      const linkPath = path.join(mindPath, '.chamber', 'automation', 'evil.ts');
      try {
        fs.symlinkSync(outsideScript, linkPath);
      } catch {
        // Symlinks may be unavailable (Windows without dev mode). Skip.
        return;
      }
      expect(() => validateScriptPath(mindPath, '.chamber/automation/evil.ts'))
        .toThrow(/escapes mind root/);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
