/**
 * Sullivan's presentation rubric — per-step and cross-step evaluators.
 *
 * Each rule is a pure function over a `Step` and a `RubricContext`
 * (`{ allSteps, index }`) that returns a `Finding` if the step violates
 * the rule, or `null` if it passes. The signature is uniform — even
 * rules that only look at the current step still accept and ignore the
 * context, so the rubric runner can iterate without per-rule branching.
 *
 * The motion-sensitive rules consume the pinned constants from
 * `./motionLimits` rather than inlining literals; this lets the
 * value-pin tests in `motionLimits.test.ts` catch silent drift across
 * both the constants and any rubric that depends on them.
 */

import {
  MAX_AGGREGATE_TRANSITION_DURATION_MS,
  MAX_TRANSITION_DURATION_MS,
} from './motionLimits';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Finding severity:
 *   - `block` — must be fixed before publishing (typically a WCAG-level
 *     accessibility issue).
 *   - `warn`  — a pedagogical or cognitive-load concern; the deck still
 *     ships but the author should address it.
 *   - `note`  — a stylistic suggestion; safe to ignore on a case-by-case
 *     basis.
 */
export type Severity = 'block' | 'warn' | 'note';

export type RuleCategory = 'pedagogy' | 'accessibility';

export interface ImageRef {
  readonly src: string;
  readonly alt?: string;
  readonly decorative?: boolean;
}

export interface TransitionRef {
  readonly name: string;
  readonly durationMs: number;
}

/**
 * Minimum step shape the Phase 2 evaluators need. Phase 7's `types-barrel`
 * todo will hoist this into a shared types module; until then it lives
 * here next to the rules that consume it.
 *
 * TODO(types-barrel): move `Step`/`ImageRef`/`TransitionRef` to a shared
 * package once the Phase 3 tool layer settles on the final fields.
 */
export interface Step {
  readonly id: string;
  readonly title: string;
  readonly oneIdea?: boolean;
  readonly content?: string;
  readonly images?: readonly ImageRef[];
  readonly transitions?: readonly TransitionRef[];
  readonly narrativeBridge?: string;
}

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  readonly suggestion?: string;
}

export interface RubricContext {
  readonly allSteps: readonly Step[];
  readonly index: number;
}

export type RuleEvaluator = (step: Step, context: RubricContext) => Finding | null;

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly severity: Severity;
  readonly summary: string;
  readonly rationale: string;
  readonly evaluator: RuleEvaluator;
}

// -----------------------------------------------------------------------------
// Sullivan editorial thresholds (non-motion).
// Motion thresholds live in `./motionLimits.ts`.
// -----------------------------------------------------------------------------

/**
 * Maximum word count per step.
 *
 * Sullivan editorial choice grounded in Sweller's Cognitive Load Theory
 * (Sweller, 1988) and Mayer's Segmenting Principle (Mayer, Multimedia
 * Learning, 2009). 75 words is roughly 30s of slow reading — long enough
 * to develop one idea, short enough to keep working memory unloaded.
 */
export const MAX_STEP_WORD_COUNT = 75;

/**
 * Token-set Jaccard similarity at which two steps are considered
 * redundant. 0.7 means 70% of distinct content tokens overlap.
 *
 * Sullivan editorial choice grounded in Mayer's Redundancy Principle
 * (Mayer, Multimedia Learning, 2009). Below this threshold, partial
 * overlap is treated as legitimate reinforcement rather than duplication.
 */
export const REDUNDANCY_JACCARD_THRESHOLD = 0.7;

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sumTransitionDurations(steps: readonly Step[]): number {
  let total = 0;
  for (const step of steps) {
    if (!step.transitions) continue;
    for (const t of step.transitions) {
      total += t.durationMs;
    }
  }
  return total;
}

function freezeRule(rule: Rule): Rule {
  return Object.freeze(rule);
}

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

const oneIdeaRule: Rule = freezeRule({
  id: 'one-idea',
  category: 'pedagogy',
  severity: 'warn',
  summary: 'Each step should communicate a single idea.',
  rationale:
    'Reynolds (Presentation Zen, 2008) — "one slide, one idea" — and ' +
    "Mayer's Coherence Principle (Mayer, Multimedia Learning, 2009, ch. 5) " +
    'both argue that extraneous material on a slide hurts comprehension. ' +
    'Sullivan flags steps that have explicitly declared more than one idea ' +
    'so the author can split them before publishing.',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    // Per-step rule: context is accepted to preserve the uniform Rule
    // signature but is not consulted by this evaluator.
    void context;
    if (step.oneIdea !== false) return null;
    return {
      rule: 'one-idea',
      severity: 'warn',
      message: `Step "${step.title}" declares more than one idea (oneIdea: false).`,
      suggestion:
        'Split this step into separate steps, each carrying a single idea ' +
        '(Mayer, Coherence Principle).',
    };
  },
});

const cognitiveLoadRule: Rule = freezeRule({
  id: 'cognitive-load',
  category: 'pedagogy',
  severity: 'warn',
  summary: `Step content should stay within a ${MAX_STEP_WORD_COUNT}-word per-step budget.`,
  rationale:
    "Sweller's Cognitive Load Theory (Sweller, \"Cognitive Load During " +
    'Problem Solving", Cognitive Science, 1988) and Mayer\'s Segmenting ' +
    'Principle (Mayer, Multimedia Learning, 2009) both argue for chunking ' +
    'material into small, learner-paced units. Sullivan caps each step at ' +
    `${MAX_STEP_WORD_COUNT} words as an editorial reduction grounded in ` +
    'those sources, not as a WCAG mandate.',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    // Per-step rule: context is accepted to preserve the uniform Rule
    // signature but is not consulted by this evaluator.
    void context;
    if (step.content === undefined) return null;
    const words = countWords(step.content);
    if (words <= MAX_STEP_WORD_COUNT) return null;
    return {
      rule: 'cognitive-load',
      severity: 'warn',
      message:
        `Step "${step.title}" has ${words} words, exceeding the ` +
        `${MAX_STEP_WORD_COUNT}-word per-step budget.`,
      suggestion:
        `Trim to ≤ ${MAX_STEP_WORD_COUNT} words or split into multiple steps ` +
        '(Mayer, Segmenting Principle).',
    };
  },
});

const missingAltTextIntentRule: Rule = freezeRule({
  id: 'missing-alt-text-intent',
  category: 'accessibility',
  severity: 'block',
  summary: 'Every image must declare alt text or be explicitly marked decorative.',
  rationale:
    'WCAG 2.1 SC 1.1.1 (Non-text Content, Level A) requires a text ' +
    'alternative for non-text content, with an explicit exception for pure ' +
    'decoration when assistive technology can ignore it. Sullivan enforces ' +
    'an "intent" check: every image must either carry non-empty alt text or ' +
    'be explicitly flagged decorative — silence is not a valid intent. ' +
    'https://www.w3.org/TR/WCAG21/#non-text-content',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    // Per-step rule: context is accepted to preserve the uniform Rule
    // signature but is not consulted by this evaluator.
    void context;
    if (!step.images || step.images.length === 0) return null;
    for (const img of step.images) {
      const altIsBlank = !img.alt || img.alt.trim().length === 0;
      if (altIsBlank && img.decorative !== true) {
        return {
          rule: 'missing-alt-text-intent',
          severity: 'block',
          message:
            `Image "${img.src}" on step "${step.title}" has neither alt text ` +
            'nor an explicit decorative marker.',
          suggestion:
            "Add alt text describing the image's purpose, or mark " +
            'decorative: true if the image is purely ornamental (WCAG 1.1.1).',
        };
      }
    }
    return null;
  },
});

const motionPerTransitionRule: Rule = freezeRule({
  id: 'motion-per-transition',
  category: 'accessibility',
  severity: 'block',
  summary: `Each transition duration must be ≤ ${MAX_TRANSITION_DURATION_MS}ms.`,
  rationale:
    'WCAG 2.1 SC 2.2.2 (Pause, Stop, Hide, Level A) requires pause-controls ' +
    'for motion lasting more than 5 seconds. Sullivan tightens this to ' +
    `${MAX_TRANSITION_DURATION_MS}ms per transition so individual step ` +
    'changes never approach the pause-control trigger and per-step ' +
    'cognitive load stays low. ' +
    'https://www.w3.org/TR/WCAG21/#pause-stop-hide',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    // Per-step rule: context is accepted to preserve the uniform Rule
    // signature but is not consulted by this evaluator.
    void context;
    if (!step.transitions) return null;
    for (const t of step.transitions) {
      if (t.durationMs > MAX_TRANSITION_DURATION_MS) {
        return {
          rule: 'motion-per-transition',
          severity: 'block',
          message:
            `Transition "${t.name}" on step "${step.title}" is ` +
            `${t.durationMs}ms, exceeding the ${MAX_TRANSITION_DURATION_MS}ms ` +
            'per-transition cap.',
          suggestion:
            `Reduce duration to ≤ ${MAX_TRANSITION_DURATION_MS}ms (WCAG 2.2.2).`,
        };
      }
    }
    return null;
  },
});

const narrativeContinuityRule: Rule = freezeRule({
  id: 'narrative-continuity',
  category: 'pedagogy',
  severity: 'note',
  summary:
    'Every non-first step should carry an explicit narrative bridge from ' +
    'the previous step.',
  rationale:
    "Mayer's Signaling Principle (Mayer, Multimedia Learning, 2009, ch. 7) " +
    'argues that making the structure of the material explicit improves ' +
    'learning. Sullivan asks every non-first step for a one-line bridge so ' +
    'the deck reads as continuous narrative rather than as a flat sequence ' +
    'of independent slides.',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    if (context.index === 0) return null;
    const bridge = step.narrativeBridge;
    if (bridge !== undefined && bridge.trim().length > 0) return null;
    const previous = context.allSteps[context.index - 1];
    return {
      rule: 'narrative-continuity',
      severity: 'note',
      message:
        `Step "${step.title}" has no narrative bridge from the previous ` +
        `step "${previous.title}".`,
      suggestion:
        `Add a one-sentence narrativeBridge linking "${previous.title}" to ` +
        `"${step.title}" (Mayer, Signaling Principle).`,
    };
  },
});

const redundantContentRule: Rule = freezeRule({
  id: 'redundant-content',
  category: 'pedagogy',
  severity: 'note',
  summary: 'A step should not duplicate the content of an earlier step.',
  rationale:
    "Mayer's Redundancy Principle (Mayer, Multimedia Learning, 2009, ch. 6) " +
    'argues that presenting the same information twice in the same channel ' +
    'hurts learning. Sullivan flags any step whose token-set Jaccard ' +
    `similarity with an earlier step is ≥ ${REDUNDANCY_JACCARD_THRESHOLD}. ` +
    'The rule fires only on the duplicate, never the original, so each ' +
    'overlap is reported exactly once.',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    if (step.content === undefined) return null;
    const here = tokenSet(step.content);
    if (here.size === 0) return null;
    for (let i = 0; i < context.index; i += 1) {
      const other = context.allSteps[i];
      if (other.content === undefined) continue;
      const there = tokenSet(other.content);
      if (there.size === 0) continue;
      const similarity = jaccardSimilarity(here, there);
      if (similarity >= REDUNDANCY_JACCARD_THRESHOLD) {
        const pct = Math.round(similarity * 100);
        return {
          rule: 'redundant-content',
          severity: 'note',
          message:
            `Step "${step.title}" overlaps ${pct}% with earlier step ` +
            `"${other.title}".`,
          suggestion:
            `Merge "${step.title}" into "${other.title}" or trim the ` +
            'duplicate content (Mayer, Redundancy Principle).',
        };
      }
    }
    return null;
  },
});

const motionAggregateRule: Rule = freezeRule({
  id: 'motion-aggregate',
  category: 'accessibility',
  severity: 'block',
  summary:
    'Aggregate transition duration across a deck must be ≤ ' +
    `${MAX_AGGREGATE_TRANSITION_DURATION_MS}ms.`,
  rationale:
    'WCAG 2.1 SC 2.2.2 (Pause, Stop, Hide, Level A) and SC 2.3.3 (Animation ' +
    'from Interactions, Level AAA) together motivate minimising ' +
    'non-essential motion across an experience. Sullivan caps the aggregate ' +
    `of all transition durations at ${MAX_AGGREGATE_TRANSITION_DURATION_MS}` +
    'ms — an editorial reduction layered on the WCAG floor, not a WCAG ' +
    'mandate. The finding lands on the last step only, so the aggregate is ' +
    'reported once per deck rather than once per step. ' +
    'https://www.w3.org/TR/WCAG21/#pause-stop-hide ' +
    'https://www.w3.org/TR/WCAG21/#animation-from-interactions',
  evaluator: (step: Step, context: RubricContext): Finding | null => {
    if (context.index !== context.allSteps.length - 1) return null;
    const total = sumTransitionDurations(context.allSteps);
    if (total <= MAX_AGGREGATE_TRANSITION_DURATION_MS) return null;
    return {
      rule: 'motion-aggregate',
      severity: 'block',
      message:
        `Aggregate transition duration is ${total}ms, exceeding the ` +
        `${MAX_AGGREGATE_TRANSITION_DURATION_MS}ms total motion budget for ` +
        `step "${step.title}" (last in deck).`,
      suggestion:
        'Trim or shorten transitions so the aggregate is ≤ ' +
        `${MAX_AGGREGATE_TRANSITION_DURATION_MS}ms (WCAG 2.2.2 / 2.3.3).`,
    };
  },
});

// -----------------------------------------------------------------------------
// Public rubric
// -----------------------------------------------------------------------------

/**
 * The full Sullivan rubric. Frozen at module load so downstream consumers
 * cannot mutate the shared rule set; each rule object is also frozen so
 * its evaluator/severity/citation cannot be swapped at runtime.
 */
export const RUBRIC: ReadonlyArray<Rule> = Object.freeze([
  oneIdeaRule,
  cognitiveLoadRule,
  missingAltTextIntentRule,
  motionPerTransitionRule,
  narrativeContinuityRule,
  redundantContentRule,
  motionAggregateRule,
]);
