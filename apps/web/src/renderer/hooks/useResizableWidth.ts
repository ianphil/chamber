import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Drag from the left edge of the panel (true) or the right edge (false). */
  edge?: 'left' | 'right';
}

/**
 * Persistent, pointer-drag panel-width hook. Returns the current width plus a
 * `handleProps` bundle to spread on a 4px-wide grip element. The grip should
 * be absolutely positioned along the chosen edge.
 *
 * Width is saved to localStorage so the layout survives reloads. On pointer
 * down the grip captures the pointer (`setPointerCapture`), so subsequent
 * `onPointerMove` events keep firing on the grip even when the cursor leaves
 * it, and the drag only ends on `onPointerUp`.
 *
 * The grip is also keyboard-operable: `handleProps` makes it focusable and
 * exposes `aria-value*` plus an `onKeyDown` that resizes by 16px on Arrow
 * Left/Right, so the separator works without a pointer.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max, edge = 'left' }: Options) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultWidth;
    const n = Number(raw);
    if (!Number.isFinite(n)) return defaultWidth;
    return Math.min(max, Math.max(min, n));
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, width]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    // Dragging the left edge expands when the pointer moves left.
    const signed = edge === 'left' ? -delta : delta;
    const next = Math.min(max, Math.max(min, startWidth.current + signed));
    setWidth(next);
  }, [edge, max, min]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const STEP = 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth((w) => Math.max(min, w - STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth((w) => Math.min(max, w + STEP));
    }
  }, [min, max]);

  const reset = useCallback(() => setWidth(defaultWidth), [defaultWidth]);

  return {
    width,
    setWidth,
    reset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      tabIndex: 0,
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': width,
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
  };
}
