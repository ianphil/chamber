import type { AppFeatureFlags } from '@chamber/shared/feature-flags';

export function applyWtdRuntimeAvailability(
  flags: AppFeatureFlags,
  runtimeAvailable: boolean,
): AppFeatureFlags {
  return {
    ...flags,
    wtdTopology: flags.wtdTopology && runtimeAvailable,
  };
}
