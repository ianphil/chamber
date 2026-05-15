/**
 * Public type surface for the Sullivan presentation capability.
 *
 * This barrel re-exports the shared pedagogy / accessibility types from
 * `./rubric` and the tool input/output result types from `./tools` so
 * downstream consumers can import everything from one place:
 *
 *   import type { Step, Finding, CritiqueResult } from '@chamber/services/sullivan';
 *
 * `SullivanService` is declared in `./tools` (to keep this phase's diff
 * additive) and re-exported here. The public symbol name is stable —
 * Phase 5's composition root references it through this barrel.
 *
 * Internal helpers (`validateSteps`, `runRubricPerStep`,
 * `recommendContrast`, `recommendTransition`, `summarize`) are not
 * re-exported and remain module-private to `./tools`. Motion-limit and
 * rubric constants (`MAX_TRANSITION_DURATION_MS`, `RUBRIC`,
 * `MAX_STEP_WORD_COUNT`, ...) are reachable through their owning module
 * paths and are intentionally not part of the public type surface.
 */

// -----------------------------------------------------------------------------
// Shared pedagogy / accessibility types — sourced from the rubric.
// -----------------------------------------------------------------------------

export type {
  Step,
  Finding,
  Rule,
  Severity,
  RuleCategory,
  ImageRef,
  TransitionRef,
  RubricContext,
  RuleEvaluator,
} from './rubric';

// -----------------------------------------------------------------------------
// Tool input / output public types — sourced from the tool builder.
// -----------------------------------------------------------------------------

export type {
  SullivanService,
  PresentationTemplateInput,
  PresentationTemplateGuidance,
  PresentationTemplateResult,
  OutlineValidateInput,
  OutlineValidateResult,
  CritiqueInput,
  CritiqueResult,
  PerStepFindings,
  ContrastPairInput,
  ContrastCheckInput,
  ContrastCheckResult,
  WcagLevelResult,
  TransitionInput,
  MotionBudgetInput,
  MotionBudgetResult,
  PerTransitionResult,
  AggregateMotionResult,
  FindingSummary,
} from './tools';
