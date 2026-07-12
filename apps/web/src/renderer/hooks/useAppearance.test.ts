/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDensity, useFontScale } from './useAppearance';
import { appearanceStore } from '../lib/appearanceStore';
import { APPEARANCE_STORAGE_KEYS } from '../lib/appearance';

describe('useFontScale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  afterEach(() => {
    appearanceStore.resetForTests();
    document.documentElement.className = '';
  });

  it('reflects the persisted scale and applies it on start', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.fontScale, 'large');
    appearanceStore.resetForTests();
    appearanceStore.start();

    const { result } = renderHook(() => useFontScale());

    expect(result.current.fontScale).toBe('large');
    expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
  });

  it('applies and persists a change', () => {
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useFontScale());

    act(() => result.current.setFontScale('small'));

    expect(result.current.fontScale).toBe('small');
    expect(document.documentElement.classList.contains('font-scale-small')).toBe(true);
    expect(document.documentElement.classList.contains('font-scale-medium')).toBe(false);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.fontScale)).toBe('small');
  });

  it('mirrors a change made in another window', () => {
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useFontScale());

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.fontScale, newValue: 'large' }),
      );
    });

    expect(result.current.fontScale).toBe('large');
    expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
  });
});

describe('useDensity', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  afterEach(() => {
    appearanceStore.resetForTests();
    document.documentElement.className = '';
  });

  it('reflects the persisted density and applies it on start', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.density, 'compact');
    appearanceStore.resetForTests();
    appearanceStore.start();

    const { result } = renderHook(() => useDensity());

    expect(result.current.density).toBe('compact');
    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
  });

  it('applies and persists a change', () => {
    appearanceStore.resetForTests();
    appearanceStore.start();
    const { result } = renderHook(() => useDensity());

    act(() => result.current.setDensity('compact'));

    expect(result.current.density).toBe('compact');
    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
    expect(document.documentElement.classList.contains('density-comfortable')).toBe(false);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.density)).toBe('compact');
  });
});
