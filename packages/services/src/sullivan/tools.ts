/**
 * Sullivan's five pure presentation tools.
 *
 * Each tool is a deterministic, side-effect-free function over its
 * declared inputs. The five tools compose the Phase 1 / Phase 2
 * primitives (`./contrast`, `./motionLimits`, `./rubric`) — no fresh
 * math, no fs, no electron, no network, no global state.
 *
 * Validation failures (input that doesn't match the documented shape)
 * **throw**, so the SDK surfaces them as tool errors. Rubric findings,
 * contrast failures, and motion-budget violations are **successful
 * returns** — the finding *is* the result.
 *
 * Phase 3 layering note:
 *   `buildSullivanTools` accepts a `SullivanService` parameter to
 *   mirror `buildCanvasTools` and reserve the wiring slot for the
 *   Phase 4 service implementation. Phase 3 handlers compose the
 *   Phase 1/2 modules directly and do not consume the service.
 */

import type { SessionTool } from '../a2a/tools';
import { contrastRatio, passesAA, passesAAA } from './contrast';
import {
  MAX_AGGREGATE_TRANSITION_DURATION_MS,
  MAX_TRANSITION_DURATION_MS,
  REDUCED_MOTION_EQUIVALENT,
  VESTIBULAR_RISKY_TRANSITIONS,
} from './motionLimits';
import {
  MAX_STEP_WORD_COUNT,
  RUBRIC,
  type Finding,
  type Severity,
  type Step,
} from './rubric';

// -----------------------------------------------------------------------------
// SullivanService — forward-declared interface (Phase 4 will implement).
// -----------------------------------------------------------------------------

/**
 * Forward declaration for the concrete service that Phase 4 will
 * implement. Phase 3 handlers compose the Phase 1/2 modules directly
 * and do not call any service methods. The interface remains in
 * `tools.ts` so the `buildSullivanTools(mindId, mindPath, service)`
 * signature stays stable across phases — the wiring in Phase 4 / 5
 * can pass a real service without touching the tool builder shape.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SullivanService {}

// -----------------------------------------------------------------------------
// Public result types — exported so downstream consumers can import them.
// -----------------------------------------------------------------------------

export interface PresentationTemplateInput {
  readonly topic: string;
  readonly audience: string;
  readonly learningObjective: string;
  readonly timeBudgetMinutes?: number;
}

export interface PresentationTemplateGuidance {
  readonly oneIdeaPerStep: true;
  readonly maxWordsPerSlide: number;
  readonly timeBudgetTargetMinutes: number | null;
}

export interface PresentationTemplateResult {
  readonly thesis: '';
  readonly narrativeArc: readonly string[];
  readonly steps: readonly Step[];
  readonly guidance: PresentationTemplateGuidance;
}

export interface OutlineValidateInput {
  readonly thesis?: string;
  readonly narrativeArc?: readonly string[];
  readonly steps: readonly Step[];
}

export interface FindingSummary {
  readonly blockCount: number;
  readonly warnCount: number;
  readonly noteCount: number;
}

export interface OutlineValidateResult {
  readonly findings: readonly Finding[];
  readonly summary: FindingSummary;
}

export interface CritiqueInput {
  readonly steps: readonly Step[];
}

export interface PerStepFindings {
  readonly stepId: string;
  readonly findings: readonly Finding[];
}

export interface CritiqueResult {
  readonly findings: readonly Finding[];
  readonly perStep: readonly PerStepFindings[];
  readonly summary: FindingSummary;
}

export interface ContrastPairInput {
  readonly foreground: string;
  readonly background: string;
  readonly label?: string;
}

export interface ContrastCheckInput {
  readonly pairs: readonly ContrastPairInput[];
}

export interface WcagLevelResult {
  readonly largeText: boolean;
  readonly normalText: boolean;
}

export interface ContrastCheckResult {
  readonly label?: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly AA: WcagLevelResult;
  readonly AAA: WcagLevelResult;
  readonly recommendation: string;
}

export interface TransitionInput {
  readonly id?: string;
  readonly durationMs: number;
  readonly type?: string;
}

export interface MotionBudgetInput {
  readonly transitions: readonly TransitionInput[];
}

export interface PerTransitionResult {
  readonly id?: string;
  readonly durationMs: number;
  readonly type?: string;
  readonly withinPerTransitionBudget: boolean;
  readonly reducedMotionEquivalent: string;
  readonly recommendation: string;
}

export interface AggregateMotionResult {
  readonly totalDurationMs: number;
  readonly withinAggregateBudget: boolean;
  readonly recommendation: string;
}

export interface MotionBudgetResult {
  readonly perTransition: readonly PerTransitionResult[];
  readonly aggregate: AggregateMotionResult;
}

// -----------------------------------------------------------------------------
// Default safe reduced-motion fallback for transitions with no declared type.
// Sourced from REDUCED_MOTION_EQUIVALENT (zoom/parallax/spin/flip → fade) so
// the fallback stays coherent with the same map.
// -----------------------------------------------------------------------------

const DEFAULT_REDUCED_MOTION_EQUIVALENT = 'fade';

// -----------------------------------------------------------------------------
// Input validation — throws Error on malformed input so the SDK surfaces it.
// -----------------------------------------------------------------------------

function asObject(args: unknown, label: string): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error(`${label} input must be an object.`);
  }
  return args as Record<string, unknown>;
}

function requireNonBlankString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`"${label}" is required and must be a non-empty string.`);
  }
  return value;
}

function validatePositiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`"${label}" must be a positive finite number.`);
  }
  return value;
}

function validateTemplateInput(args: unknown): {
  topic: string;
  audience: string;
  learningObjective: string;
  timeBudgetMinutes: number | null;
} {
  const obj = asObject(args, 'presentation_template');
  const topic = requireNonBlankString(obj.topic, 'topic');
  const audience = requireNonBlankString(obj.audience, 'audience');
  const learningObjective = requireNonBlankString(obj.learningObjective, 'learningObjective');
  let timeBudgetMinutes: number | null = null;
  if (obj.timeBudgetMinutes !== undefined && obj.timeBudgetMinutes !== null) {
    timeBudgetMinutes = validatePositiveFiniteNumber(obj.timeBudgetMinutes, 'timeBudgetMinutes');
  }
  return { topic, audience, learningObjective, timeBudgetMinutes };
}

function validateSteps(steps: readonly unknown[]): readonly Step[] {
  const seenIds = new Set<string>();
  for (let i = 0; i < steps.length; i += 1) {
    const raw = steps[i];
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Step at index ${i} must be an object.`);
    }
    const step = raw as Record<string, unknown>;

    if (typeof step.id !== 'string' || step.id.length === 0) {
      throw new Error(`Step at index ${i} is missing required field "id".`);
    }
    if (typeof step.title !== 'string' || step.title.length === 0) {
      throw new Error(`Step "${step.id}" is missing required field "title".`);
    }
    if (seenIds.has(step.id)) {
      throw new Error(`Duplicate step id "${step.id}" at index ${i}.`);
    }
    seenIds.add(step.id);

    if (step.oneIdea !== undefined && typeof step.oneIdea !== 'boolean') {
      throw new Error(`Step "${step.id}" field "oneIdea" must be a boolean when provided.`);
    }
    if (step.content !== undefined && typeof step.content !== 'string') {
      throw new Error(`Step "${step.id}" field "content" must be a string when provided.`);
    }
    if (step.narrativeBridge !== undefined && typeof step.narrativeBridge !== 'string') {
      throw new Error(`Step "${step.id}" field "narrativeBridge" must be a string when provided.`);
    }
    validateStepTransitions(step.id, step.transitions);
    validateStepImages(step.id, step.images);
  }
  return steps as readonly Step[];
}

function validateStepTransitions(stepId: string, transitions: unknown): void {
  if (transitions === undefined) return;
  if (!Array.isArray(transitions)) {
    throw new Error(`Step "${stepId}" field "transitions" must be an array when provided.`);
  }
  for (let j = 0; j < transitions.length; j += 1) {
    const t = transitions[j];
    if (typeof t !== 'object' || t === null) {
      throw new Error(`Step "${stepId}" transition at index ${j} must be an object.`);
    }
    const tr = t as Record<string, unknown>;
    if (typeof tr.name !== 'string' || tr.name.length === 0) {
      throw new Error(`Step "${stepId}" transition at index ${j} is missing required field "name".`);
    }
    if (typeof tr.durationMs !== 'number' || !Number.isFinite(tr.durationMs) || tr.durationMs < 0) {
      throw new Error(
        `Step "${stepId}" transition "${tr.name}" has invalid durationMs (must be a non-negative finite number).`,
      );
    }
  }
}

function validateStepImages(stepId: string, images: unknown): void {
  if (images === undefined) return;
  if (!Array.isArray(images)) {
    throw new Error(`Step "${stepId}" field "images" must be an array when provided.`);
  }
  for (let j = 0; j < images.length; j += 1) {
    const img = images[j];
    if (typeof img !== 'object' || img === null) {
      throw new Error(`Step "${stepId}" image at index ${j} must be an object.`);
    }
    const im = img as Record<string, unknown>;
    if (typeof im.src !== 'string' || im.src.length === 0) {
      throw new Error(`Step "${stepId}" image at index ${j} is missing required field "src".`);
    }
  }
}

function validateOutlineInput(args: unknown): {
  thesis: string;
  narrativeArc: readonly string[];
  steps: readonly Step[];
} {
  const obj = asObject(args, 'presentation_outline_validate');
  if (obj.thesis !== undefined && typeof obj.thesis !== 'string') {
    throw new Error('"thesis" must be a string when provided.');
  }
  if (obj.narrativeArc !== undefined) {
    if (!Array.isArray(obj.narrativeArc)) {
      throw new Error('"narrativeArc" must be an array of strings when provided.');
    }
    for (const item of obj.narrativeArc) {
      if (typeof item !== 'string') {
        throw new Error('"narrativeArc" items must be strings.');
      }
    }
  }
  if (obj.steps === undefined) {
    throw new Error('"steps" is required.');
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error('"steps" must be an array.');
  }
  const steps = validateSteps(obj.steps);
  return {
    thesis: (obj.thesis as string | undefined) ?? '',
    narrativeArc: (obj.narrativeArc as readonly string[] | undefined) ?? [],
    steps,
  };
}

function validateCritiqueInput(args: unknown): readonly Step[] {
  const obj = asObject(args, 'presentation_critique');
  if (obj.steps === undefined) {
    throw new Error('"steps" is required.');
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error('"steps" must be an array.');
  }
  return validateSteps(obj.steps);
}

function validateContrastInput(args: unknown): readonly ContrastPairInput[] {
  const obj = asObject(args, 'presentation_contrast_check');
  if (obj.pairs === undefined) {
    throw new Error('"pairs" is required.');
  }
  if (!Array.isArray(obj.pairs)) {
    throw new Error('"pairs" must be an array.');
  }
  const pairs: ContrastPairInput[] = [];
  for (let i = 0; i < obj.pairs.length; i += 1) {
    const raw = obj.pairs[i];
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Pair at index ${i} must be an object.`);
    }
    const pair = raw as Record<string, unknown>;
    if (typeof pair.foreground !== 'string' || pair.foreground.length === 0) {
      throw new Error(`Pair at index ${i} requires "foreground" as a non-empty string.`);
    }
    if (typeof pair.background !== 'string' || pair.background.length === 0) {
      throw new Error(`Pair at index ${i} requires "background" as a non-empty string.`);
    }
    if (pair.label !== undefined && typeof pair.label !== 'string') {
      throw new Error(`Pair at index ${i} field "label" must be a string when provided.`);
    }
    pairs.push({
      foreground: pair.foreground,
      background: pair.background,
      ...(pair.label !== undefined ? { label: pair.label as string } : {}),
    });
  }
  return pairs;
}

function validateMotionInput(args: unknown): readonly TransitionInput[] {
  const obj = asObject(args, 'presentation_motion_budget');
  if (obj.transitions === undefined) {
    throw new Error('"transitions" is required.');
  }
  if (!Array.isArray(obj.transitions)) {
    throw new Error('"transitions" must be an array.');
  }
  const transitions: TransitionInput[] = [];
  for (let i = 0; i < obj.transitions.length; i += 1) {
    const raw = obj.transitions[i];
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Transition at index ${i} must be an object.`);
    }
    const tx = raw as Record<string, unknown>;
    if (
      typeof tx.durationMs !== 'number' ||
      !Number.isFinite(tx.durationMs) ||
      tx.durationMs <= 0
    ) {
      throw new Error(
        `Transition at index ${i} has invalid durationMs (must be a positive finite number).`,
      );
    }
    if (tx.id !== undefined && typeof tx.id !== 'string') {
      throw new Error(`Transition at index ${i} field "id" must be a string when provided.`);
    }
    if (tx.type !== undefined && typeof tx.type !== 'string') {
      throw new Error(`Transition at index ${i} field "type" must be a string when provided.`);
    }
    transitions.push({
      durationMs: tx.durationMs,
      ...(tx.id !== undefined ? { id: tx.id as string } : {}),
      ...(tx.type !== undefined ? { type: tx.type as string } : {}),
    });
  }
  return transitions;
}

// -----------------------------------------------------------------------------
// Composition helpers — wrap the Phase 1 / Phase 2 modules.
// -----------------------------------------------------------------------------

function runRubricPerStep(steps: readonly Step[]): {
  global: Finding[];
  perStep: PerStepFindings[];
} {
  const perStepFindings: Finding[][] = steps.map(() => []);
  const global: Finding[] = [];
  // Rule-major, step-minor iteration so the global order matches the
  // RUBRIC declaration order and is stable across calls.
  for (const rule of RUBRIC) {
    for (let index = 0; index < steps.length; index += 1) {
      const finding = rule.evaluator(steps[index], { allSteps: steps, index });
      if (finding !== null) {
        global.push(finding);
        perStepFindings[index].push(finding);
      }
    }
  }
  const perStep: PerStepFindings[] = steps.map((step, i) => ({
    stepId: step.id,
    findings: perStepFindings[i],
  }));
  return { global, perStep };
}

function summarize(findings: readonly Finding[]): FindingSummary {
  let blockCount = 0;
  let warnCount = 0;
  let noteCount = 0;
  for (const f of findings) {
    const severity: Severity = f.severity;
    if (severity === 'block') blockCount += 1;
    else if (severity === 'warn') warnCount += 1;
    else noteCount += 1;
  }
  return { blockCount, warnCount, noteCount };
}

function recommendContrast(ratio: number): string {
  if (passesAAA(ratio, false)) {
    return `Passes WCAG AAA for both normal and large text (ratio ${ratio.toFixed(2)}).`;
  }
  if (passesAA(ratio, false)) {
    return (
      `Passes WCAG AA for normal text and AAA for large text only ` +
      `(ratio ${ratio.toFixed(2)}); increase contrast to meet AAA for normal text.`
    );
  }
  if (passesAA(ratio, true)) {
    return (
      `Passes WCAG AA for large text only (ratio ${ratio.toFixed(2)}); ` +
      `fails AA for normal text — increase contrast (WCAG 1.4.3).`
    );
  }
  return (
    `Fails WCAG AA at every text size (ratio ${ratio.toFixed(2)}); ` +
    `increase contrast significantly (WCAG 1.4.3 / 1.4.6).`
  );
}

function computeReducedMotionEquivalent(type: string | undefined): string {
  if (type === undefined) return DEFAULT_REDUCED_MOTION_EQUIVALENT;
  if (VESTIBULAR_RISKY_TRANSITIONS.has(type)) {
    return REDUCED_MOTION_EQUIVALENT[type];
  }
  return type;
}

function recommendTransition(
  transition: TransitionInput,
  withinBudget: boolean,
  reducedEquivalent: string,
): string {
  const reasons: string[] = [];
  if (!withinBudget) {
    reasons.push(
      `Exceeds per-transition cap of ${MAX_TRANSITION_DURATION_MS}ms (WCAG 2.2.2) — ` +
        `reduce duration to ≤ ${MAX_TRANSITION_DURATION_MS}ms.`,
    );
  }
  if (transition.type !== undefined && VESTIBULAR_RISKY_TRANSITIONS.has(transition.type)) {
    reasons.push(
      `Vestibular risk (WCAG 2.3.3) — provide "${reducedEquivalent}" as the ` +
        `prefers-reduced-motion fallback.`,
    );
  }
  if (reasons.length === 0) {
    return (
      `Within per-transition budget ` +
      `(${transition.durationMs}/${MAX_TRANSITION_DURATION_MS}ms).`
    );
  }
  return reasons.join(' ');
}

function recommendAggregate(totalDurationMs: number, withinBudget: boolean): string {
  if (withinBudget) {
    return (
      `Within aggregate motion budget ` +
      `(${totalDurationMs}/${MAX_AGGREGATE_TRANSITION_DURATION_MS}ms).`
    );
  }
  const overBy = totalDurationMs - MAX_AGGREGATE_TRANSITION_DURATION_MS;
  return (
    `Exceeds aggregate motion budget by ${overBy}ms — trim transitions ` +
    `to bring the total ≤ ${MAX_AGGREGATE_TRANSITION_DURATION_MS}ms (WCAG 2.2.2 / 2.3.3).`
  );
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

async function handlePresentationTemplate(
  args: Record<string, unknown>,
): Promise<PresentationTemplateResult> {
  const input = validateTemplateInput(args);
  // The template is canonical (empty scaffold). Inputs are validated to
  // surface bad calls but do not feed into the returned shape — that's
  // the contract: an empty outline + structural guidance, deterministic
  // across every well-formed call.
  void input.topic;
  void input.audience;
  void input.learningObjective;
  return {
    thesis: '',
    narrativeArc: [],
    steps: [],
    guidance: {
      oneIdeaPerStep: true,
      maxWordsPerSlide: MAX_STEP_WORD_COUNT,
      timeBudgetTargetMinutes: input.timeBudgetMinutes,
    },
  };
}

async function handlePresentationOutlineValidate(
  args: Record<string, unknown>,
): Promise<OutlineValidateResult> {
  const { steps } = validateOutlineInput(args);
  const { global } = runRubricPerStep(steps);
  return { findings: global, summary: summarize(global) };
}

async function handlePresentationCritique(
  args: Record<string, unknown>,
): Promise<CritiqueResult> {
  const steps = validateCritiqueInput(args);
  const { global, perStep } = runRubricPerStep(steps);
  return { findings: global, perStep, summary: summarize(global) };
}

async function handlePresentationContrastCheck(
  args: Record<string, unknown>,
): Promise<readonly ContrastCheckResult[]> {
  const pairs = validateContrastInput(args);
  // contrastRatio throws on malformed hex via parseHexColor — that
  // throw propagates out and the SDK surfaces it as a tool error.
  return pairs.map((p) => {
    const ratio = contrastRatio(p.foreground, p.background);
    const aa: WcagLevelResult = {
      largeText: passesAA(ratio, true),
      normalText: passesAA(ratio, false),
    };
    const aaa: WcagLevelResult = {
      largeText: passesAAA(ratio, true),
      normalText: passesAAA(ratio, false),
    };
    return {
      ...(p.label !== undefined ? { label: p.label } : {}),
      foreground: p.foreground,
      background: p.background,
      ratio,
      AA: aa,
      AAA: aaa,
      recommendation: recommendContrast(ratio),
    };
  });
}

async function handlePresentationMotionBudget(
  args: Record<string, unknown>,
): Promise<MotionBudgetResult> {
  const transitions = validateMotionInput(args);
  let totalDurationMs = 0;
  const perTransition: PerTransitionResult[] = transitions.map((t) => {
    totalDurationMs += t.durationMs;
    const withinPer = t.durationMs <= MAX_TRANSITION_DURATION_MS;
    const reducedMotionEquivalent = computeReducedMotionEquivalent(t.type);
    return {
      ...(t.id !== undefined ? { id: t.id } : {}),
      durationMs: t.durationMs,
      ...(t.type !== undefined ? { type: t.type } : {}),
      withinPerTransitionBudget: withinPer,
      reducedMotionEquivalent,
      recommendation: recommendTransition(t, withinPer, reducedMotionEquivalent),
    };
  });
  const withinAggregateBudget = totalDurationMs <= MAX_AGGREGATE_TRANSITION_DURATION_MS;
  return {
    perTransition,
    aggregate: {
      totalDurationMs,
      withinAggregateBudget,
      recommendation: recommendAggregate(totalDurationMs, withinAggregateBudget),
    },
  };
}

// -----------------------------------------------------------------------------
// Builder
// -----------------------------------------------------------------------------

/**
 * Build the five Sullivan presentation tools for a session. Mirrors
 * `buildCanvasTools(mindId, mindPath, service)` so the composition root
 * can wire Sullivan the same way it wires Canvas.
 *
 * Phase 3: handlers compose Phase 1 / Phase 2 modules directly and
 * the `service` parameter is reserved for Phase 4's concrete service.
 */
export function buildSullivanTools(
  mindId: string,
  mindPath: string,
  service: SullivanService,
): SessionTool[] {
  // Reserved for Phase 4 wiring. The signature stays stable so the
  // composition root won't need to change when the real service lands.
  void mindId;
  void mindPath;
  void service;

  return [
    {
      name: 'presentation_template',
      description:
        'Return a canonical empty outline scaffold (thesis, narrativeArc, steps) plus the structural guidance constants (one idea per step, max words per slide, time-budget target) the author should use when filling it in.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The subject of the presentation.' },
          audience: { type: 'string', description: 'Who the presentation is for.' },
          learningObjective: {
            type: 'string',
            description: 'What the audience should be able to do or know after the presentation.',
          },
          timeBudgetMinutes: {
            type: 'number',
            description: 'Optional target total presentation length in minutes (must be a positive finite number).',
          },
        },
        required: ['topic', 'audience', 'learningObjective'],
      },
      handler: handlePresentationTemplate,
    },
    {
      name: 'presentation_outline_validate',
      description:
        'Run the Sullivan pedagogy + accessibility rubric across an outline and return the findings plus a severity-bucketed summary. Findings (including block-severity) are a successful return — only malformed input throws.',
      parameters: {
        type: 'object',
        properties: {
          thesis: { type: 'string', description: 'Optional outline thesis statement.' },
          narrativeArc: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional ordered list of narrative beats for the outline.',
          },
          steps: {
            type: 'array',
            description: 'Steps in the outline. Each step requires id and title.',
            items: { type: 'object' },
          },
        },
        required: ['steps'],
      },
      handler: handlePresentationOutlineValidate,
    },
    {
      name: 'presentation_critique',
      description:
        'Run the full Sullivan rubric across drafted steps and return findings, a per-step breakdown, and a severity summary. Block-severity findings are a successful return; malformed step input throws.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Steps in the drafted outline. Each step requires id and title.',
            items: { type: 'object' },
          },
        },
        required: ['steps'],
      },
      handler: handlePresentationCritique,
    },
    {
      name: 'presentation_contrast_check',
      description:
        'Compute WCAG 2.1 contrast ratios for an array of foreground / background colour pairs and return AA + AAA pass/fail (normal and large text) plus a recommendation. Malformed hex throws.',
      parameters: {
        type: 'object',
        properties: {
          pairs: {
            type: 'array',
            description: 'Foreground / background colour pairs to evaluate.',
            items: {
              type: 'object',
              properties: {
                foreground: { type: 'string', description: 'Foreground colour (hex, e.g. "#1a1a1a").' },
                background: { type: 'string', description: 'Background colour (hex, e.g. "#ffffff").' },
                label: { type: 'string', description: 'Optional label for the pair (e.g. "body text").' },
              },
              required: ['foreground', 'background'],
            },
          },
        },
        required: ['pairs'],
      },
      handler: handlePresentationContrastCheck,
    },
    {
      name: 'presentation_motion_budget',
      description:
        'Check transitions against the Sullivan per-transition (800ms, WCAG 2.2.2) and aggregate (4000ms, WCAG 2.2.2 / 2.3.3) motion budgets. Returns per-transition status with a vestibular-safe reduced-motion equivalent plus an aggregate budget verdict. Non-finite / non-positive durations throw.',
      parameters: {
        type: 'object',
        properties: {
          transitions: {
            type: 'array',
            description: 'Transitions to evaluate against the motion budget.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Optional transition identifier.' },
                durationMs: {
                  type: 'number',
                  description: 'Transition duration in milliseconds (positive, finite).',
                },
                type: {
                  type: 'string',
                  description: 'Optional transition kind (e.g. "fade", "zoom", "parallax").',
                },
              },
              required: ['durationMs'],
            },
          },
        },
        required: ['transitions'],
      },
      handler: handlePresentationMotionBudget,
    },
  ];
}
