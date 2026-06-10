import type { Plugin } from 'vite';

const VIRTUAL_MODULE_ID = 'virtual:chamber-plugin';
const RESOLVED_VIRTUAL_MODULE_ID = '\0virtual:chamber-plugin';

/**
 * Builds the source for the `virtual:chamber-plugin` module. When an enterprise
 * renderer entry is configured, the module re-exports that entry's default
 * export (a `ChamberRendererPlugin`). Otherwise it exports a no-op plugin so the
 * base Chamber build keeps its built-in onboarding and other surfaces.
 */
export function buildChamberPluginModuleSource(rendererEntry: string | undefined): string {
  const entry = rendererEntry?.trim();
  if (entry) {
    return `export { default } from ${JSON.stringify(entry)};\n`;
  }
  return `export default { id: 'chamber-noop' };\n`;
}

/**
 * Vite plugin that serves `virtual:chamber-plugin`. The base build resolves it
 * to a no-op plugin; enterprise builds point `CHAMBER_PLUGIN_RENDERER` at their
 * renderer plugin entry to override Chamber surfaces (e.g. onboarding).
 */
export function chamberPluginVirtualModule(
  rendererEntry: string | undefined = process.env.CHAMBER_PLUGIN_RENDERER,
): Plugin {
  return {
    name: 'chamber:plugin-virtual-module',
    resolveId(id) {
      return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    load(id) {
      return id === RESOLVED_VIRTUAL_MODULE_ID ? buildChamberPluginModuleSource(rendererEntry) : null;
    },
  };
}
