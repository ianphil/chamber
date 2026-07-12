/**
 * Appearance preferences: the single source of truth for how Chamber's theme,
 * font scale, and density are read, persisted, and applied to the document.
 *
 * Kept framework-agnostic (no React) so the renderer entry can apply stored
 * preferences before first paint and the appearance hooks can share the exact
 * same read/apply logic instead of duplicating it.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
/** The concrete theme applied to the DOM once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';
export type FontScale = 'small' | 'medium' | 'large';
export type Density = 'comfortable' | 'compact';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export const FONT_SCALES = ['small', 'medium', 'large'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;

// Defaults preserve the previously hardcoded dark look so existing users see no
// change until they opt into a different appearance.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';
export const DEFAULT_FONT_SCALE: FontScale = 'medium';
export const DEFAULT_DENSITY: Density = 'comfortable';

export const APPEARANCE_STORAGE_KEYS = {
  theme: 'chamber.theme',
  fontScale: 'chamber.fontScale',
  density: 'chamber.density',
} as const;

const FONT_SCALE_CLASSES: Record<FontScale, string> = {
  small: 'font-scale-small',
  medium: 'font-scale-medium',
  large: 'font-scale-large',
};

const DENSITY_CLASSES: Record<Density, string> = {
  comfortable: 'density-comfortable',
  compact: 'density-compact',
};

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// Keep aligned with the 450ms color transition in index.css so the
// `theme-switching` class clears exactly as the crossfade ends.
const THEME_TRANSITION_MS = 450;

// ---------------------------------------------------------------------------
// Generic persistence
// ---------------------------------------------------------------------------

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(stored ?? '') ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable */
  }
}

/** Swap the single active class from `classes` on the document root. */
function applyRootClass(classes: readonly string[], active: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove(...classes);
  root.classList.add(active);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function readStoredThemePreference(): ThemePreference {
  return readChoice(APPEARANCE_STORAGE_KEYS.theme, THEME_PREFERENCES, DEFAULT_THEME_PREFERENCE);
}

export function persistThemePreference(preference: ThemePreference): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.theme, preference);
}

/** Whether the OS currently reports a dark color-scheme preference. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export interface ApplyThemeOptions {
  /** Play the global crossfade transition. Off for the first paint on load. */
  readonly animate?: boolean;
}

export function applyResolvedTheme(resolved: ResolvedTheme, options: ApplyThemeOptions = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (options.animate) {
    // Mark the document as "mid-swap" so the global color transition kicks in
    // just for this paint, then clear it once the crossfade ends.
    root.classList.add('theme-switching');
    window.setTimeout(() => root.classList.remove('theme-switching'), THEME_TRANSITION_MS);
  }
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  // Repaint the native Windows titleBarOverlay so the OS chrome stays legible
  // against the new app background.
  try {
    void window.desktop?.setTheme?.(resolved);
  } catch {
    /* desktop bridge may not be present in browser smoke tests */
  }
}

// ---------------------------------------------------------------------------
// Font scale
// ---------------------------------------------------------------------------

export function readStoredFontScale(): FontScale {
  return readChoice(APPEARANCE_STORAGE_KEYS.fontScale, FONT_SCALES, DEFAULT_FONT_SCALE);
}

export function persistFontScale(scale: FontScale): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.fontScale, scale);
}

export function applyFontScale(scale: FontScale): void {
  applyRootClass(Object.values(FONT_SCALE_CLASSES), FONT_SCALE_CLASSES[scale]);
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

export function readStoredDensity(): Density {
  return readChoice(APPEARANCE_STORAGE_KEYS.density, DENSITIES, DEFAULT_DENSITY);
}

export function persistDensity(density: Density): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.density, density);
}

export function applyDensity(density: Density): void {
  applyRootClass(Object.values(DENSITY_CLASSES), DENSITY_CLASSES[density]);
}
