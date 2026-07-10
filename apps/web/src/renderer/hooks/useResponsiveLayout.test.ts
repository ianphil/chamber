/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResponsiveLayout } from './useResponsiveLayout';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('useResponsiveLayout', () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    setViewportWidth(1440);
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true, writable: true });
  });

  it('reports a wide viewport as no-clamp and no-auto-collapse', () => {
    setViewportWidth(1440);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.shouldAutoCollapseHistory).toBe(false);
    expect(result.current.shouldClampMindSidebar).toBe(false);
  });

  it('auto-collapses history below the lg breakpoint (1024px)', () => {
    setViewportWidth(900);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.shouldAutoCollapseHistory).toBe(true);
    expect(result.current.shouldClampMindSidebar).toBe(false);
  });

  it('clamps the mind sidebar below the md breakpoint (768px)', () => {
    setViewportWidth(700);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.shouldAutoCollapseHistory).toBe(true);
    expect(result.current.shouldClampMindSidebar).toBe(true);
  });

  it('responds to window resize events', () => {
    setViewportWidth(1440);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.shouldAutoCollapseHistory).toBe(false);

    act(() => setViewportWidth(900));
    expect(result.current.shouldAutoCollapseHistory).toBe(true);

    act(() => setViewportWidth(1440));
    expect(result.current.shouldAutoCollapseHistory).toBe(false);
  });
});
