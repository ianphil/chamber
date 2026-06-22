import type { ComponentType } from 'react';

/**
 * Describes a mind for an onboarding surface to create through Chamber. The
 * plugin supplies a marketplace template to install and, optionally, an
 * onboarding document to seed into the new mind. Chamber owns where the
 * document is written; the plugin only supplies its content.
 */
export interface OnboardingMindRequest {
  /** Marketplace template id to install (e.g. a marketplace agent template). */
  readonly templateId: string;
  /** Marketplace id the template is sourced from, when not the default. */
  readonly marketplaceId?: string;
  /**
   * Optional onboarding document to seed into the newly created mind. Chamber
   * writes it to a fixed, Chamber-owned path inside the mind but does not read
   * it back itself; a plugin's own template or agent is responsible for
   * consuming it. When omitted, no document is written.
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
   * with the new mind id or an error. Implemented by Chamber so the surface does
   * not have to drive template install, document seeding, and mind selection
   * itself. The surface still calls `onComplete` when it is ready to dismiss the
   * gate.
   */
  createMind: (request: OnboardingMindRequest) => Promise<OnboardingMindResult>;
  /**
   * Serves a plugin-provided HTML document (e.g. an onboarding wizard engine)
   * over Chamber's loopback canvas server and resolves with a URL to load in a
   * sandboxed iframe. Unlike the plugin itself, this served HTML is genuinely
   * isolated: it runs at a separate origin from the renderer, so it executes its
   * own inline scripts and uses storage without reaching the renderer's globals
   * or Chamber's privileged APIs. The surface reports results back via
   * `window.parent.postMessage`; Chamber tears the canvas down when onboarding
   * completes. Optional: a host that does not implement it simply cannot serve a
   * plugin onboarding canvas, and the plugin should fall back or surface that.
   */
  serveOnboardingCanvas?: (html: string) => Promise<string>;
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
 *
 * A renderer plugin is trusted code: because it is bundled into the renderer it
 * shares the renderer's globals and can reach `window.electronAPI` directly. The
 * capabilities on `OnboardingProps` are ergonomic, Chamber-owned entry points
 * for the common case, not an isolation boundary around the plugin.
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
