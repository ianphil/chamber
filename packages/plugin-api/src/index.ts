export type {
  ChamberRendererPlugin,
  OnboardingProps,
  OnboardingProvider,
} from './renderer-plugin';
export type {
  ChamberMainPlugin,
  MainPluginContext,
  PluginLogLevel,
} from './main-plugin';

import type { ChamberRendererPlugin } from './renderer-plugin';
import type { ChamberMainPlugin } from './main-plugin';

/**
 * Identity helper that gives plugin authors full type-checking and inference
 * when declaring a renderer plugin. Purely a compile-time convenience.
 */
export function defineRendererPlugin(plugin: ChamberRendererPlugin): ChamberRendererPlugin {
  return plugin;
}

/**
 * Identity helper that gives plugin authors full type-checking and inference
 * when declaring a main-process plugin. Purely a compile-time convenience.
 */
export function defineMainPlugin(plugin: ChamberMainPlugin): ChamberMainPlugin {
  return plugin;
}
