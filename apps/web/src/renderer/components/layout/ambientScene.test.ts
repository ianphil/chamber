/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { THEME_MS, VERTEX_SHADER, FRAGMENT_SHADER, easeInOut, themeTarget } from './ambientScene';

describe('ambientScene', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('eases from 0 to 1 with a slow-in/slow-out midpoint', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
    // slow-in: first quarter advances less than linear
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    // slow-out: last quarter is past linear
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
  });

  it('maps the dark theme to night (0) and light to day (1)', () => {
    document.documentElement.classList.add('dark');
    expect(themeTarget()).toBe(0);
    document.documentElement.classList.remove('dark');
    expect(themeTarget()).toBe(1);
  });

  it('exposes a positive crossfade duration', () => {
    expect(THEME_MS).toBeGreaterThan(0);
  });

  it('declares the u_theme uniform the renderer animates', () => {
    expect(FRAGMENT_SHADER).toContain('u_theme');
    expect(VERTEX_SHADER).toContain('gl_Position');
  });
});
