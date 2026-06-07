/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type * as React from 'react';
import { useResizableWidth } from './useResizableWidth';

const baseOptions = { storageKey: 'test:resizable-width', defaultWidth: 240, min: 140, max: 400 };

function keyEvent(key: string) {
  const preventDefault = vi.fn();
  const event = { key, preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>;
  return { event, preventDefault };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('useResizableWidth', () => {
  it('exposes accessible separator props on the grip', () => {
    const { result } = renderHook(() => useResizableWidth(baseOptions));
    const props = result.current.handleProps;
    expect(props.role).toBe('separator');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-orientation']).toBe('vertical');
    expect(props['aria-valuenow']).toBe(240);
    expect(props['aria-valuemin']).toBe(140);
    expect(props['aria-valuemax']).toBe(400);
    expect(typeof props.onKeyDown).toBe('function');
  });

  it('widens on ArrowRight and narrows on ArrowLeft by a fixed 16px step', () => {
    const { result } = renderHook(() => useResizableWidth(baseOptions));

    const right = keyEvent('ArrowRight');
    act(() => {
      result.current.handleProps.onKeyDown(right.event);
    });
    expect(right.preventDefault).toHaveBeenCalled();
    expect(result.current.width).toBe(256);

    const left = keyEvent('ArrowLeft');
    act(() => {
      result.current.handleProps.onKeyDown(left.event);
    });
    expect(result.current.width).toBe(240);
  });

  it('clamps keyboard resizing to the configured max', () => {
    const { result } = renderHook(() => useResizableWidth({ ...baseOptions, defaultWidth: 396 }));
    act(() => {
      result.current.handleProps.onKeyDown(keyEvent('ArrowRight').event);
    });
    expect(result.current.width).toBe(400);
  });

  it('ignores keys other than the horizontal arrows', () => {
    const { result } = renderHook(() => useResizableWidth(baseOptions));
    act(() => {
      result.current.handleProps.onKeyDown(keyEvent('ArrowUp').event);
    });
    expect(result.current.width).toBe(240);
  });
});
