import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  parseHexColor,
  passesAA,
  passesAAA,
  relativeLuminance,
  srgbChannelToLinear,
} from './contrast';

describe('parseHexColor', () => {
  it('accepts six-digit hex with leading hash', () => {
    expect(parseHexColor('#ffffff')).toEqual([255, 255, 255]);
  });

  it('accepts six-digit hex without leading hash', () => {
    expect(parseHexColor('000000')).toEqual([0, 0, 0]);
  });

  it('accepts three-digit shorthand and expands each nibble', () => {
    expect(parseHexColor('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('is case-insensitive', () => {
    expect(parseHexColor('#AaBbCc')).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('accepts all-uppercase hex', () => {
    expect(parseHexColor('#FFFFFF')).toEqual([255, 255, 255]);
  });

  it('throws on malformed input', () => {
    expect(() => parseHexColor('not-a-color')).toThrow(/invalid hex color/i);
    expect(() => parseHexColor('#1234')).toThrow(/invalid hex color/i);
    expect(() => parseHexColor('')).toThrow(/invalid hex color/i);
  });
});

describe('srgbChannelToLinear', () => {
  it('returns 0 for 0', () => {
    expect(srgbChannelToLinear(0)).toBeCloseTo(0, 10);
  });

  it('returns 1 for 255', () => {
    expect(srgbChannelToLinear(255)).toBeCloseTo(1, 10);
  });

  it('uses the linear branch for low values (c <= 0.03928)', () => {
    // 10 / 255 ≈ 0.0392 — still in the linear branch
    const value = 10;
    const normalized = value / 255;
    expect(srgbChannelToLinear(value)).toBeCloseTo(normalized / 12.92, 10);
  });

  it('uses the gamma branch for high values (c > 0.03928)', () => {
    // 128 / 255 ≈ 0.502 — gamma branch
    const value = 128;
    const normalized = value / 255;
    const expected = Math.pow((normalized + 0.055) / 1.055, 2.4);
    expect(srgbChannelToLinear(value)).toBeCloseTo(expected, 10);
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 10);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
  });

  it('weighted sum of RGB channels matches WCAG 2.1 formula', () => {
    // Pure red at full intensity should have luminance ≈ 0.2126
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
    // Pure green ≈ 0.7152
    expect(relativeLuminance([0, 255, 0])).toBeCloseTo(0.7152, 4);
    // Pure blue ≈ 0.0722
    expect(relativeLuminance([0, 0, 255])).toBeCloseTo(0.0722, 4);
  });
});

describe('contrastRatio', () => {
  it('black on white is exactly 21.00', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('white on white is exactly 1.00', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric — order of arguments does not matter', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#000000'),
      5,
    );
  });

  it('#777777 on #ffffff is just below the AA normal-text threshold', () => {
    // Canonical WCAG example: medium gray vs white, ratio ≈ 4.48
    const ratio = contrastRatio('#777777', '#ffffff');
    expect(ratio).toBeGreaterThan(4.4);
    expect(ratio).toBeLessThan(4.5);
  });

  it('#595959 on #ffffff meets AA normal-text threshold', () => {
    // Canonical WCAG example: darker gray vs white, ratio ≈ 7.0
    const ratio = contrastRatio('#595959', '#ffffff');
    expect(ratio).toBeGreaterThan(6.9);
    expect(ratio).toBeLessThan(7.1);
  });
});

describe('passesAA', () => {
  it('requires ratio >= 4.5 for normal text', () => {
    expect(passesAA(4.5, false)).toBe(true);
    expect(passesAA(4.49, false)).toBe(false);
  });

  it('requires ratio >= 3.0 for large text', () => {
    expect(passesAA(3.0, true)).toBe(true);
    expect(passesAA(2.99, true)).toBe(false);
  });

  it('treats undefined largeText as normal text', () => {
    expect(passesAA(4.5)).toBe(true);
    expect(passesAA(4.49)).toBe(false);
  });
});

describe('passesAAA', () => {
  it('requires ratio >= 7.0 for normal text', () => {
    expect(passesAAA(7.0, false)).toBe(true);
    expect(passesAAA(6.99, false)).toBe(false);
  });

  it('requires ratio >= 4.5 for large text', () => {
    expect(passesAAA(4.5, true)).toBe(true);
    expect(passesAAA(4.49, true)).toBe(false);
  });

  it('treats undefined largeText as normal text', () => {
    expect(passesAAA(7.0)).toBe(true);
    expect(passesAAA(6.99)).toBe(false);
  });
});
