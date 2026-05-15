/**
 * WCAG 2.1 contrast math.
 *
 * Formulas from:
 *   - https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *   - https://www.w3.org/TR/WCAG21/#contrast-minimum
 *
 * Kept as pure functions so they are trivially testable and reusable by any
 * future Sullivan surface (and any other chamber service) without dragging
 * the rest of the pedagogy provider in as a dependency.
 */

const HEX_FULL = /^#?([0-9a-f]{6})$/i;
const HEX_SHORT = /^#?([0-9a-f]{3})$/i;

export type Rgb = readonly [number, number, number];

export function parseHexColor(hex: string): Rgb {
  if (typeof hex !== 'string' || hex.length === 0) {
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  }
  const fullMatch = HEX_FULL.exec(hex);
  if (fullMatch) {
    const hex6 = fullMatch[1];
    return [
      parseInt(hex6.slice(0, 2), 16),
      parseInt(hex6.slice(2, 4), 16),
      parseInt(hex6.slice(4, 6), 16),
    ];
  }
  const shortMatch = HEX_SHORT.exec(hex);
  if (shortMatch) {
    const hex3 = shortMatch[1];
    const expand = (digit: string): number => parseInt(`${digit}${digit}`, 16);
    return [expand(hex3[0]), expand(hex3[1]), expand(hex3[2])];
  }
  throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
}

export function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  const linearR = srgbChannelToLinear(r);
  const linearG = srgbChannelToLinear(g);
  const linearB = srgbChannelToLinear(b);
  return 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
}

export function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(parseHexColor(fg));
  const lBg = relativeLuminance(parseHexColor(bg));
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

export function passesAA(ratio: number, largeText: boolean = false): boolean {
  return ratio >= (largeText ? 3.0 : 4.5);
}

export function passesAAA(ratio: number, largeText: boolean = false): boolean {
  return ratio >= (largeText ? 4.5 : 7.0);
}
