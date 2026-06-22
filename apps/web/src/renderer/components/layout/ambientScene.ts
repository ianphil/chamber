/**
 * Animated day/night ambient background — shared shader + transition math.
 *
 * Renders a full-screen WebGL gradient that morphs between a deep-forest
 * "night" palette (genesis-green + cool-blue auroras) and a near-white "day"
 * palette. The morph is driven by a single `u_theme` uniform (0 = night,
 * 1 = day) so the whole transition is a one-line interpolation in the shader.
 *
 * The glow centres are fixed (no time-based drift): the background is fully
 * determined by theme + viewport, so it stays perfectly still when idle and
 * only animates while the theme is being crossfaded. This mirrors the static
 * CSS `.app-ambient` gradient it replaces, just animated across the swap.
 */

/** Duration of the night<->day crossfade, in milliseconds. Kept in sync with
 * the `.theme-switching` CSS color crossfade (450ms) so the canvas and the UI
 * surfaces finish their day/night swap at the same moment. */
export const THEME_MS = 450;

/** Full-screen triangle vertex shader. */
export const VERTEX_SHADER = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

/**
 * Fragment shader. `u_theme` smoothly interpolates every palette term between
 * the night (0.0) and day (1.0) constants, so a single animated uniform drives
 * the entire crossfade. Output is gamma-encoded via `toSRGB`.
 */
export const FRAGMENT_SHADER = `
precision highp float;
uniform vec2  u_res;
uniform float u_theme;  // 0.0 = night, 1.0 = day
uniform float u_time;   // seconds; only advances while an agent is working
uniform float u_active; // 0.0 = idle .. 1.0 = an agent is actively working

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 toSRGB(vec3 c){ return pow(c, vec3(0.4545)); }

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;

  // --- NIGHT: deep-forest base, genesis-green + cool-blue auroras ---
  // Blue leads (matching master's dark .app-ambient), with the genesis green
  // pulled toward teal and dialed back so it reads as a faint tint rather than
  // washing the whole window green.
  vec3  nBase  = vec3(0.002, 0.005, 0.004);
  vec3  nGlowA = vec3(0.05, 0.24, 0.22); // genesis green (teal-leaning)
  vec3  nGlowB = vec3(0.06, 0.13, 0.34); // cool blue
  float nAmtA = 0.018, nAmtB = 0.034, nDith = 0.010;

  // --- DAY: near-white base, faint cool + warm auroras ---
  vec3  dBase  = vec3(0.94, 0.96, 0.99);
  vec3  dGlowA = vec3(0.55, 0.70, 0.62);
  vec3  dGlowB = vec3(0.62, 0.68, 0.95);
  float dAmtA = 0.05, dAmtB = 0.05, dDith = 0.005;

  float th    = u_theme;
  vec3  base  = mix(nBase,  dBase,  th);
  vec3  glowA = mix(nGlowA, dGlowA, th);
  vec3  glowB = mix(nGlowB, dGlowB, th);
  float amtA  = mix(nAmtA,  dAmtA,  th);
  float amtB  = mix(nAmtB,  dAmtB,  th);
  float dith  = mix(nDith,  dDith,  th);

  // Fixed glow centres echo the CSS .app-ambient gradient positions
  // (top-left genesis halo, top-right cool halo, both above the top edge).
  vec2  cA = vec2(0.12, 1.08);
  vec2  cB = vec2(1.05, 1.06);

  // While an agent is working the genesis aurora gently breathes: a slow
  // amplitude pulse plus a faint vertical drift of its centre. Scaled by the
  // night weight so the daytime palette stays calm, and by u_active so it
  // eases in and out as work starts and stops.
  float night   = 1.0 - th;
  float breathe = sin(u_time * 1.1) * 0.5 + 0.5; // 0..1
  amtA *= 1.0 + u_active * night * (0.45 + 0.55 * breathe);
  cA.y += u_active * night * 0.05 * sin(u_time * 0.5);

  float gA = smoothstep(0.95, 0.0, distance(uv, cA));
  float gB = smoothstep(0.95, 0.0, distance(uv, cB));

  vec3 col = base + glowA * gA * amtA + glowB * gB * amtB;

  // Night only: damp the aurora along the very top edge so it doesn't clash
  // with the titlebar sitting over it. topShade ramps from 0 a little way
  // down the viewport to 1 at the top edge; (1.0 - th) zeroes it out by day.
  float topShade = smoothstep(0.80, 1.0, uv.y);
  col *= mix(1.0, 0.32, topShade * (1.0 - th));

  col += (hash(gl_FragCoord.xy) - 0.5) * dith; // dither to kill banding
  gl_FragColor = vec4(toSRGB(col), 1.0);
}
`;

/**
 * Eased 0..1 transition curve (slow in, slow out). easeInOutCubic -- a gentler
 * slow-in and a longer, softer slow-out than quad, so the day/night morph
 * glides into place. The CSS surfaces use its cubic-bezier equivalent
 * (0.65, 0, 0.35, 1) so the canvas and the UI advance along the same curve.
 */
export function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Current document theme as a `u_theme` target: night (dark) = 0, day = 1. */
export function themeTarget(): 0 | 1 {
  if (typeof document === 'undefined') return 0;
  return document.documentElement.classList.contains('dark') ? 0 : 1;
}
