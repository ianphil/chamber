/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appearanceStore } from './appearanceStore';
import { APPEARANCE_STORAGE_KEYS } from './appearance';

function installMatchMedia(initialDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initialDark;
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
  return {
    emit(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
    },
  };
}

describe('appearanceStore', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    appearanceStore.resetForTests();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('applies persisted preferences to the document when started', () => {
    installMatchMedia(false);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'light');
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.fontScale, 'large');
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.density, 'compact');
    appearanceStore.resetForTests();

    appearanceStore.start();

    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('font-scale-large')).toBe(true);
    expect(root.classList.contains('density-compact')).toBe(true);
    // The initial paint must not animate the crossfade.
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('follows the OS scheme live for a system preference without any UI mounted', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'system');
    appearanceStore.resetForTests();
    appearanceStore.start();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    media.emit(true);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(appearanceStore.getSnapshot().resolvedTheme).toBe('dark');
  });

  it('mirrors theme, font size, and density changes from other windows', () => {
    installMatchMedia(true);
    appearanceStore.resetForTests();
    appearanceStore.start();

    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.theme, newValue: 'light' }));
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.fontScale, newValue: 'small' }));
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.density, newValue: 'compact' }));

    const snapshot = appearanceStore.getSnapshot();
    expect(snapshot.themePreference).toBe('light');
    expect(snapshot.fontScale).toBe('small');
    expect(snapshot.density).toBe('compact');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('font-scale-small')).toBe(true);
    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
  });

  it('persists and applies setter changes and notifies subscribers', () => {
    installMatchMedia(true);
    appearanceStore.resetForTests();
    appearanceStore.start();
    const listener = vi.fn();
    appearanceStore.subscribe(listener);

    appearanceStore.setThemePreference('light');
    appearanceStore.setFontScale('large');
    appearanceStore.setDensity('compact');

    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)).toBe('light');
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.fontScale)).toBe('large');
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.density)).toBe('compact');
    expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('toggles between light and dark from the shown theme', () => {
    installMatchMedia(true);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'dark');
    appearanceStore.resetForTests();
    appearanceStore.start();

    appearanceStore.toggleTheme();
    expect(appearanceStore.getSnapshot().resolvedTheme).toBe('light');

    appearanceStore.toggleTheme();
    expect(appearanceStore.getSnapshot().resolvedTheme).toBe('dark');
  });

  it('stops responding to OS changes after reset', () => {
    const media = installMatchMedia(false);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'system');
    appearanceStore.resetForTests();
    appearanceStore.start();

    appearanceStore.resetForTests();
    media.emit(true);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
