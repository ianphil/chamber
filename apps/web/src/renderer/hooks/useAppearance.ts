import { useSyncExternalStore } from 'react';
import { appearanceStore } from '../lib/appearanceStore';
import type { Density, FontScale } from '../lib/appearance';

export type { FontScale, Density } from '../lib/appearance';

export interface UseFontScaleResult {
  readonly fontScale: FontScale;
  readonly setFontScale: (scale: FontScale) => void;
}

/**
 * Reads the interface font-scale from the always-on appearance store and exposes
 * a setter. The store owns application and cross-window synchronization.
 */
export function useFontScale(): UseFontScaleResult {
  const state = useSyncExternalStore(appearanceStore.subscribe, appearanceStore.getSnapshot);
  return { fontScale: state.fontScale, setFontScale: appearanceStore.setFontScale };
}

export interface UseDensityResult {
  readonly density: Density;
  readonly setDensity: (density: Density) => void;
}

/**
 * Reads the interface density from the always-on appearance store and exposes a
 * setter. The store owns application and cross-window synchronization.
 */
export function useDensity(): UseDensityResult {
  const state = useSyncExternalStore(appearanceStore.subscribe, appearanceStore.getSnapshot);
  return { density: state.density, setDensity: appearanceStore.setDensity };
}
