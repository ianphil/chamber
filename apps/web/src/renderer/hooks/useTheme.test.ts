/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';
import { appearanceStore } from '../lib/appearanceStore';
import { APPEARANCE_STORAGE_KEYS } from '../lib/appearance';

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

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    appearanceStore.resetForTests();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('reflects the persisted preference and its resolved theme', () => {
    installMatchMedia(false);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'light');
    appearanceStore.resetForTests();
    appearanceStore.start();

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('persists and applies an explicit preference change', () => {
    installMatchMedia(true);
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('light'));

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)).toBe('light');
  });

  it('follows the OS scheme live when the preference is system', () => {
    const media = installMatchMedia(false);
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('system'));
    expect(result.current.resolvedTheme).toBe('light');

    act(() => media.emit(true));
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('mirrors a preference change made in another window', () => {
    installMatchMedia(true);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'dark');
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.theme, newValue: 'light' }),
      );
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('toggles between light and dark', () => {
    installMatchMedia(true);
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'dark');
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggle());
    expect(result.current.resolvedTheme).toBe('light');

    act(() => result.current.toggle());
    expect(result.current.resolvedTheme).toBe('dark');
  });
});
