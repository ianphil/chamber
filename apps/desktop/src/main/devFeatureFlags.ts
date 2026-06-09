import type { AppFeatureFlags } from '@chamber/shared/feature-flags';

/**
 * Repo-owned defaults for `npm start` / unpackaged Electron runs.
 *
 * Packaged stable and insiders builds ignore this file; release behavior is
 * derived from the embedded app version instead. Flip these values when local
 * development needs to exercise preview surfaces independently.
 */
export const DEV_FEATURE_FLAGS: AppFeatureFlags = {
  switchboardRelay: true,
  byoLlm: true,
  chamberCopilot: true,
  voiceDictation: true,
};
