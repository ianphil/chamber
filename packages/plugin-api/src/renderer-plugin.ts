import type { ComponentType } from 'react';

/**
 * Describes a mind for an onboarding surface to create through Chamber. The
 * plugin supplies a marketplace template to install and, optionally, an
 * onboarding document to seed into the new mind. Chamber owns where the
 * document is written; the plugin only supplies its content.
 */
export interface OnboardingMindRequest {
  /** Marketplace template id to install (e.g. an enterprise agent). */
  readonly templateId: string;
  /** Marketplace id the template is sourced from, when not the default. */
  readonly marketplaceId?: string;
  /**
   * Optional onboarding document (e.g. a generated Soul Code) to seed into the
   * newly created mind. When omitted, no document is written.
   */
  readonly seedDocument?: string;
}

/** Result of an onboarding mind-creation request. */
export interface OnboardingMindResult {
  readonly success: boolean;
  /** Id of the created mind, present on success. */
  readonly mindId?: string;
  /** Human-readable failure reason, present on failure. */
  readonly error?: string;
}

/**
 * Props Chamber passes to a plugin-provided onboarding surface. The surface
 * fully replaces Chamber's built-in Genesis flow while it is mounted, so it
 * owns the entire experience until it signals completion.
 */
export interface OnboardingProps {
  /**
   * Call once the onboarding experience is finished. Chamber dismisses the
   * Genesis gate and reveals the main application shell in response.
   */
  onComplete: () => void;
  /**
   * Creates a mind from a marketplace template, optionally seeding an
   * onboarding document into it, and selects it as the active mind. Resolves
   * with the new mind id or an error. Implemented by Chamber; the plugin never
   * touches Electron APIs directly. The surface still calls `onComplete` when
   * it is ready to dismiss the gate.
   */
  createMind: (request: OnboardingMindRequest) => Promise<OnboardingMindResult>;
}

/**
 * A React component that renders an end-to-end onboarding experience. Provided
 * by a renderer plugin to override Chamber's default `GenesisFlow`.
 */
export type OnboardingProvider = ComponentType<OnboardingProps>;

/**
 * Renderer-side contribution surface. Bundled into Chamber's renderer at build
 * time via the `virtual:chamber-plugin` module. Every field is optional: a
 * plugin only declares the surfaces it overrides, and Chamber falls back to its
 * built-in behavior for everything else.
 */
export interface ChamberRendererPlugin {
  /** Stable identifier, surfaced in diagnostics. */
  readonly id: string;
  /**
   * Replaces Chamber's built-in Genesis onboarding flow. When omitted, Chamber
   * renders its default `GenesisFlow`.
   */
  readonly onboarding?: OnboardingProvider;
}
