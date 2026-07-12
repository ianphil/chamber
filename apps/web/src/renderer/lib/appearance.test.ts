/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEYS,
  applyDensity,
  applyFontScale,
  applyResolvedTheme,
  isThemePreference,
  readStoredDensity,
  readStoredFontScale,
  readStoredThemePreference,
  resolveTheme,
  systemPrefersDark,
} from './appearance';

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe('appearance preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveTheme', () => {
    it('passes explicit light and dark preferences through unchanged', () => {
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('resolves system to the OS scheme', () => {
      expect(resolveTheme('system', true)).toBe('dark');
      expect(resolveTheme('system', false)).toBe('light');
    });
  });

  describe('readStoredThemePreference', () => {
    it('defaults to dark when nothing is stored', () => {
      expect(readStoredThemePreference()).toBe('dark');
    });

    it('reads a valid stored preference', () => {
      localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'system');
      expect(readStoredThemePreference()).toBe('system');
    });

    it('falls back to the default for an unrecognized value', () => {
      localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'neon');
      expect(readStoredThemePreference()).toBe('dark');
    });
  });

  describe('isThemePreference', () => {
    it('accepts the three known preferences and rejects everything else', () => {
      expect(isThemePreference('light')).toBe(true);
      expect(isThemePreference('dark')).toBe(true);
      expect(isThemePreference('system')).toBe(true);
      expect(isThemePreference('bright')).toBe(false);
      expect(isThemePreference(null)).toBe(false);
    });
  });

  describe('systemPrefersDark', () => {
    it('reflects the OS media query', () => {
      setMatchMedia(false);
      expect(systemPrefersDark()).toBe(false);
      setMatchMedia(true);
      expect(systemPrefersDark()).toBe(true);
    });
  });

  describe('applyResolvedTheme', () => {
    it('toggles the dark class and records the theme without animating by default', () => {
      applyResolvedTheme('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.classList.contains('theme-switching')).toBe(false);

      applyResolvedTheme('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('adds the transition class when animating', () => {
      applyResolvedTheme('dark', { animate: true });
      expect(document.documentElement.classList.contains('theme-switching')).toBe(true);
    });
  });

  describe('applyFontScale', () => {
    it('applies exactly one font-scale class', () => {
      applyFontScale('large');
      expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);

      applyFontScale('small');
      expect(document.documentElement.classList.contains('font-scale-small')).toBe(true);
      expect(document.documentElement.classList.contains('font-scale-large')).toBe(false);
    });
  });

  describe('applyDensity', () => {
    it('applies exactly one density class', () => {
      applyDensity('compact');
      expect(document.documentElement.classList.contains('density-compact')).toBe(true);

      applyDensity('comfortable');
      expect(document.documentElement.classList.contains('density-comfortable')).toBe(true);
      expect(document.documentElement.classList.contains('density-compact')).toBe(false);
    });
  });

  describe('readStoredFontScale / readStoredDensity', () => {
    it('default to medium and comfortable', () => {
      expect(readStoredFontScale()).toBe('medium');
      expect(readStoredDensity()).toBe('comfortable');
    });
  });
});
