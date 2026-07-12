import { describe, it, expect, vi } from 'vitest';
import { applyTitleBarTheme, titleBarOverlayFor, TITLE_BAR_OVERLAY_HEIGHT } from './titleBarTheme';

describe('titleBarOverlayFor', () => {
  it('returns dark chrome colors for the dark theme', () => {
    expect(titleBarOverlayFor('dark')).toEqual({
      color: '#09090b',
      symbolColor: '#fafafa',
      height: TITLE_BAR_OVERLAY_HEIGHT,
    });
  });

  it('returns light chrome colors for the light theme', () => {
    expect(titleBarOverlayFor('light')).toEqual({
      color: '#ffffff',
      symbolColor: '#0a0a0a',
      height: TITLE_BAR_OVERLAY_HEIGHT,
    });
  });
});

describe('applyTitleBarTheme', () => {
  it('repaints the overlay on win32', () => {
    const setTitleBarOverlay = vi.fn();
    applyTitleBarTheme({ setTitleBarOverlay }, 'light', 'win32');
    expect(setTitleBarOverlay).toHaveBeenCalledWith(titleBarOverlayFor('light'));
  });

  it('is a no-op on non-win32 platforms', () => {
    const setTitleBarOverlay = vi.fn();
    applyTitleBarTheme({ setTitleBarOverlay }, 'dark', 'darwin');
    expect(setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it('is a no-op when no window is provided', () => {
    expect(() => applyTitleBarTheme(null, 'dark', 'win32')).not.toThrow();
    expect(() => applyTitleBarTheme(undefined, 'light', 'win32')).not.toThrow();
  });
});
