import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Validator-invariant coverage (Phase 2 v2).
 *
 * Each adapter file under `src/main/ipc/` picks exactly one validation path:
 *
 *   (a) Legacy: every `ipcMain.handle/on` call wraps its handler with
 *       `withValidation(` or `withValidationOn(`. Validation happens at the
 *       wrapper.
 *
 *   (b) Dispatcher: the file routes every registration through
 *       `makeIpcBridge(` (src/main/ipc/bridge.ts). Validation happens in
 *       `Dispatcher.invoke` against the same zod tuple schema used by the
 *       WS transport — one source of truth.
 *
 * Both strategies in the same file = drift risk. Neither = wide-open
 * channel. Both fail the build.
 */
describe('IPC validation coverage', () => {
  const IPC_DIR = join(__dirname);

  const files = readdirSync(IPC_DIR).filter(
    (f) =>
      f.endsWith('.ts') &&
      !f.endsWith('.test.ts') &&
      f !== 'withValidation.ts' &&
      f !== 'bridge.ts' &&
      f !== 'pushSink.ts',
  );

  // Regex only matches registrations whose first arg is a string literal —
  // good enough for the legacy pattern. Dispatcher files use a loop over
  // channel-name constants, so we classify them by the presence of
  // `makeIpcBridge(` and don't try to regex out each registration.
  const REG = /ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]\s*,\s*([^\n]+)/g;
  const LEGACY_PREFIXES = ['withValidation(', 'withValidationOn('];

  for (const file of files) {
    it(`every ipcMain registration in ${file} uses exactly one validation path`, () => {
      const src = readFileSync(join(IPC_DIR, file), 'utf8');
      const usesDispatcher = src.includes('makeIpcBridge(') || src.includes('makeIpcSendBridge(');
      const usesLegacy = LEGACY_PREFIXES.some((p) => src.includes(p));

      expect(
        usesDispatcher || usesLegacy,
        `${file} has no recognized validation path (neither makeIpcBridge nor withValidation).`,
      ).toBe(true);

      // Mixing strategies in the same file is a migration smell. The
      // file may temporarily mix, but that must be intentional — if this
      // assertion needs to be relaxed for a specific file, carve out an
      // explicit allow-list here and document why.
      expect(
        usesDispatcher && usesLegacy,
        `${file} mixes dispatcher (makeIpcBridge) and legacy (withValidation) ` +
          `paths. Finish the migration or split the file.`,
      ).toBe(false);

      if (usesDispatcher) {
        // Dispatcher file: require that every string-literal registration
        // in the file is NOT bare — it must at least start with makeIpcBridge(.
        // (The loop pattern uses identifier args and is naturally covered.)
        for (const match of src.matchAll(REG)) {
          const [, kind, channel, rest] = match;
          const trimmed = rest.trimStart();
          expect(
            trimmed.startsWith('makeIpcBridge(') || trimmed.startsWith('makeIpcSendBridge('),
            `ipcMain.${kind}('${channel}', ...) in ${file} must route through ` +
              `makeIpcBridge/makeIpcSendBridge in this dispatcher file. Got: ${trimmed.slice(0, 80)}`,
          ).toBe(true);
        }
        return;
      }

      // Legacy file: every string-literal registration must be wrapped.
      const matches = [...src.matchAll(REG)];
      expect(matches.length, `no ipcMain registrations found in ${file}`).toBeGreaterThan(0);
      for (const match of matches) {
        const [, kind, channel, rest] = match;
        const trimmed = rest.trimStart();
        expect(
          LEGACY_PREFIXES.some((p) => trimmed.startsWith(p)),
          `ipcMain.${kind}('${channel}', ...) in ${file} must be wrapped with ` +
            `withValidation/withValidationOn. Got: ${trimmed.slice(0, 80)}`,
        ).toBe(true);
      }
    });
  }

  it('at least one file uses the dispatcher path (migration is in progress)', () => {
    const anyDispatcher = files.some((f) =>
      readFileSync(join(IPC_DIR, f), 'utf8').includes('makeIpcBridge('),
    );
    expect(anyDispatcher).toBe(true);
  });
});
