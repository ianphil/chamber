import type { ComponentType } from 'react';

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
