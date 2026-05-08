import type { MarketplaceToolEntry } from '@chamber/shared/types';

/**
 * Catalog source — accepts either the strict {@link MarketplaceRegistry} shape
 * or the loose Genesis registry shape (where id/label/url may be undefined).
 * The catalog falls back to deriving id/label/url from owner/repo when missing.
 */
export interface ToolMarketplaceSource {
  id?: string;
  label?: string;
  url?: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  enabled?: boolean;
}

export type { MarketplaceToolEntry };
