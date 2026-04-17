import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Exhaustive channel coverage test (rubber-duck finding #5).
 *
 * Scans every `ipcMain.handle(...)` and `ipcMain.on(...)` registration under
 * `src/main/ipc/` and asserts that each call is wrapped with the corresponding
 * validation helper. One missed wrap = silent hole; representative tests are
 * not enough.
 */
describe('IPC validation coverage', () => {
  const IPC_DIR = join(__dirname);

  const files = readdirSync(IPC_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'withValidation.ts',
  );

  // Regex captures the call type (handle|on) and the second argument up to a
  // newline — good enough to distinguish `withValidation(...)` from a bare
  // arrow function.
  const REG = /ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]\s*,\s*([^\n]+)/g;

  for (const file of files) {
    it(`every ipcMain registration in ${file} is wrapped with a validator`, () => {
      const src = readFileSync(join(IPC_DIR, file), 'utf8');
      const matches = [...src.matchAll(REG)];
      expect(matches.length, `no registrations found in ${file}`).toBeGreaterThan(0);

      for (const match of matches) {
        const [, kind, channel, rest] = match;
        const expected = kind === 'handle' ? 'withValidation(' : 'withValidationOn(';
        expect(
          rest.startsWith(expected),
          `ipcMain.${kind}('${channel}', ...) in ${file} must be wrapped with ${expected.slice(0, -1)}; got: ${rest.slice(0, 60)}`,
        ).toBe(true);
      }
    });
  }
});
