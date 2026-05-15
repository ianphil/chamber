/**
 * Shared motion thresholds for Sullivan's accessibility critiques.
 *
 * Each constant cites the WCAG success criterion that motivates it.
 * Extracted to a single module so `presentation_motion_budget` (and any
 * future Sullivan or chamber surface) consumes one source of truth
 * instead of inline literals that can silently drift.
 */

/**
 * Maximum duration of a single presentation transition, in milliseconds.
 *
 * WCAG 2.2.2 (Pause, Stop, Hide) requires pause-controls for motion
 * lasting more than 5 seconds. Sullivan tightens this to 800ms per
 * transition so individual step changes never approach the pause-control
 * trigger, and so cognitive load per step stays low. The 400-800ms range
 * is widely cited as a perceptual sweet spot for slide-style transitions
 * — long enough to register, short enough to avoid interrupting flow.
 */
export const MAX_TRANSITION_DURATION_MS = 800;

/**
 * Maximum sum of all transition durations across a presentation, in
 * milliseconds.
 *
 * Same WCAG anchors as the per-transition cap, applied to the total:
 *   - WCAG 2.2.2 (Pause, Stop, Hide) — pause-controls are required for
 *     any moving content lasting more than 5 seconds presented in
 *     parallel with other content. Sullivan tightens this to a 4-second
 *     aggregate across the whole presentation so the cumulative motion
 *     budget stays comfortably under the WCAG floor without needing
 *     per-transition pause UI in a slide deck.
 *   - WCAG 2.3.3 (Animation from Interactions, AAA) — non-essential
 *     motion should be minimised and disable-able; a small aggregate
 *     budget makes that easier to honour and leaves headroom for
 *     prefers-reduced-motion fallbacks.
 *
 * The specific 4-second value is a Sullivan editorial choice (~10% of a
 * typical one-minute reading window) layered on top of those SCs, not a
 * WCAG mandate.
 */
export const MAX_AGGREGATE_TRANSITION_DURATION_MS = 4000;

/**
 * Transition names known to trigger vestibular reactions (motion
 * sickness, dizziness, disorientation) in some users.
 *
 * Source: WCAG 2.3.3 (Animation from Interactions, AAA) — large-scale
 * movement, scaling, and rotation can trigger vestibular disorders.
 * Sullivan flags any transition in this set that lacks a documented
 * reduced-motion fallback.
 */
export const VESTIBULAR_RISKY_TRANSITIONS: ReadonlySet<string> = new Set([
  'zoom',
  'parallax',
  'spin',
  'flip',
]);

/**
 * Map of risky transition names to their vestibular-safe equivalents.
 *
 * Used by `presentation_motion_budget` to suggest a drop-in alternative
 * the author can apply for prefers-reduced-motion users (WCAG 2.3.3).
 * Every entry's value MUST itself NOT be in
 * {@link VESTIBULAR_RISKY_TRANSITIONS} — guaranteed by tests.
 */
export const REDUCED_MOTION_EQUIVALENT: Readonly<Record<string, string>> = {
  zoom: 'fade',
  parallax: 'fade',
  spin: 'fade',
  flip: 'fade',
};
