import { useSyncExternalStore } from 'react';
import { appearanceStore } from '../lib/appearanceStore';
import type { ResolvedTheme, ThemePreference } from '../lib/appearance';

export type { ThemePreference, ResolvedTheme } from '../lib/appearance';

/**
 * @deprecated Use {@link ThemePreference} (the user's choice) or
 * {@link ResolvedTheme} (the value actually painted). Retained so existing
 * imports keep compiling.
 */
export type Theme = ResolvedTheme;

export interface UseThemeResult {
  /** The user's stored preference, which may be `system`. */
  readonly theme: ThemePreference;
  /** The concrete theme currently painted; never `system`. */
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (preference: ThemePreference) => void;
  readonly toggle: () => void;
}

/**
 * Reads the current theme from the always-on appearance store and exposes
 * setters. The store owns live `prefers-color-scheme` and cross-window
 * synchronization, so this hook only reflects state and forwards user intent.
 */
export function useTheme(): UseThemeResult {
  const state = useSyncExternalStore(appearanceStore.subscribe, appearanceStore.getSnapshot);
  return {
    theme: state.themePreference,
    resolvedTheme: state.resolvedTheme,
    setTheme: appearanceStore.setThemePreference,
    toggle: appearanceStore.toggleTheme,
  };
}
