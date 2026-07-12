/**
 * Appearance store: the always-on owner of runtime appearance synchronization.
 *
 * Started once from the renderer entry (not from any screen), it holds the
 * current preferences, applies them to the document, and keeps them in sync with
 * two external sources for the whole app session:
 *   - the OS color-scheme (`prefers-color-scheme`) for the `system` theme, and
 *   - other windows/tabs via the `storage` event.
 *
 * React consumes it through `useSyncExternalStore` (see the appearance hooks).
 * Settings only reads the snapshot and calls the setters; it never owns the
 * ongoing synchronization.
 */

import {
  APPEARANCE_STORAGE_KEYS,
  applyDensity,
  applyFontScale,
  applyResolvedTheme,
  DARK_MEDIA_QUERY,
  isDensity,
  isFontScale,
  isThemePreference,
  persistDensity,
  persistFontScale,
  persistThemePreference,
  readStoredDensity,
  readStoredFontScale,
  readStoredThemePreference,
  resolveTheme,
  systemPrefersDark,
  type Density,
  type FontScale,
  type ResolvedTheme,
  type ThemePreference,
} from './appearance';

export interface AppearanceState {
  readonly themePreference: ThemePreference;
  /** The concrete theme currently painted; never `system`. */
  readonly resolvedTheme: ResolvedTheme;
  readonly fontScale: FontScale;
  readonly density: Density;
}

type Listener = () => void;

class AppearanceStore {
  private themePreference: ThemePreference = readStoredThemePreference();
  private fontScale: FontScale = readStoredFontScale();
  private density: Density = readStoredDensity();
  private prefersDark: boolean = systemPrefersDark();
  private snapshot: AppearanceState = this.computeSnapshot();
  private readonly listeners = new Set<Listener>();
  private mediaQuery: MediaQueryList | null = null;
  private started = false;

  private readonly handleMedia = (event: MediaQueryListEvent): void => {
    this.prefersDark = event.matches;
    // The OS scheme only changes the resolved theme when following `system`;
    // for an explicit light/dark preference there is nothing to repaint.
    if (this.themePreference !== 'system') return;
    this.applyTheme(true);
    this.publish();
  };

  private readonly handleStorage = (event: StorageEvent): void => {
    if (event.key === APPEARANCE_STORAGE_KEYS.theme && isThemePreference(event.newValue)) {
      this.themePreference = event.newValue;
      this.applyTheme(true);
      this.publish();
    } else if (event.key === APPEARANCE_STORAGE_KEYS.fontScale && isFontScale(event.newValue)) {
      this.fontScale = event.newValue;
      applyFontScale(this.fontScale);
      this.publish();
    } else if (event.key === APPEARANCE_STORAGE_KEYS.density && isDensity(event.newValue)) {
      this.density = event.newValue;
      applyDensity(this.density);
      this.publish();
    }
  };

  /**
   * Apply the persisted preferences and begin listening for OS and cross-window
   * changes. Idempotent: safe to call once at startup. The initial paint skips
   * the theme crossfade so loading the app does not animate.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.applyTheme(false);
    applyFontScale(this.fontScale);
    applyDensity(this.density);
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
      this.mediaQuery.addEventListener('change', this.handleMedia);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorage);
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppearanceState => this.snapshot;

  setThemePreference = (preference: ThemePreference): void => {
    this.themePreference = preference;
    persistThemePreference(preference);
    this.applyTheme(true);
    this.publish();
  };

  toggleTheme = (): void => {
    const shown = resolveTheme(this.themePreference, this.prefersDark);
    this.setThemePreference(shown === 'dark' ? 'light' : 'dark');
  };

  setFontScale = (scale: FontScale): void => {
    this.fontScale = scale;
    persistFontScale(scale);
    applyFontScale(scale);
    this.publish();
  };

  setDensity = (density: Density): void => {
    this.density = density;
    persistDensity(density);
    applyDensity(density);
    this.publish();
  };

  private applyTheme(animate: boolean): void {
    applyResolvedTheme(resolveTheme(this.themePreference, this.prefersDark), { animate });
  }

  private computeSnapshot(): AppearanceState {
    return {
      themePreference: this.themePreference,
      resolvedTheme: resolveTheme(this.themePreference, this.prefersDark),
      fontScale: this.fontScale,
      density: this.density,
    };
  }

  private publish(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of this.listeners) listener();
  }

  /**
   * Detach listeners and re-read persisted state. Intended for tests so each
   * case starts from a clean, storage-derived snapshot.
   */
  resetForTests(): void {
    this.mediaQuery?.removeEventListener('change', this.handleMedia);
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.handleStorage);
    this.mediaQuery = null;
    this.started = false;
    this.listeners.clear();
    this.themePreference = readStoredThemePreference();
    this.fontScale = readStoredFontScale();
    this.density = readStoredDensity();
    this.prefersDark = systemPrefersDark();
    this.snapshot = this.computeSnapshot();
  }
}

export const appearanceStore = new AppearanceStore();

/** Begin app-wide appearance synchronization. Call once from the renderer entry. */
export function startAppearanceSync(): void {
  appearanceStore.start();
}
