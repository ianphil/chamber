import plugin from 'virtual:chamber-plugin';
import type { ChamberRendererPlugin } from '@chamber/plugin-api';

/**
 * The renderer plugin compiled into this Chamber build. Resolves to a no-op
 * plugin for the base app, or to an enterprise plugin when the build sets
 * `CHAMBER_PLUGIN_RENDERER` (see the `virtual:chamber-plugin` Vite module).
 *
 * This is the single module that touches the virtual import, so the rest of the
 * renderer (and its tests) depend only on the plain plugin object.
 */
export const activeChamberPlugin: ChamberRendererPlugin = plugin;
