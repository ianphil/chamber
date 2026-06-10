import { createContext, useContext, type ReactNode } from 'react';
import type { ChamberRendererPlugin } from '@chamber/plugin-api';

/**
 * Fallback plugin used when Chamber runs without an enterprise renderer plugin.
 * It declares no overrides, so every gate falls back to Chamber's built-in
 * behavior.
 */
export const NOOP_RENDERER_PLUGIN: ChamberRendererPlugin = { id: 'chamber-noop' };

const ChamberPluginContext = createContext<ChamberRendererPlugin>(NOOP_RENDERER_PLUGIN);

interface ChamberPluginProviderProps {
  plugin: ChamberRendererPlugin;
  children: ReactNode;
}

/**
 * Supplies the active renderer plugin to the React tree. Chamber wires this at
 * the root with the plugin resolved from `virtual:chamber-plugin`; tests can
 * wrap a subtree with an explicit fake plugin.
 */
export function ChamberPluginProvider({ plugin, children }: ChamberPluginProviderProps) {
  return <ChamberPluginContext.Provider value={plugin}>{children}</ChamberPluginContext.Provider>;
}

/** Reads the active renderer plugin. Returns the no-op plugin when unset. */
export function useChamberPlugin(): ChamberRendererPlugin {
  return useContext(ChamberPluginContext);
}
