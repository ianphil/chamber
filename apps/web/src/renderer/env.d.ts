// Ambient declarations for non-code side-effect imports in the renderer bundle.
// Vite handles these at build time; TS needs the module shapes to type-check.

declare module '*.css';

declare module 'virtual:chamber-plugin' {
  import type { ChamberRendererPlugin } from '@chamber/plugin-api';
  const plugin: ChamberRendererPlugin;
  export default plugin;
}

interface Window {
  desktop?: {
    pickFolder: () => Promise<string | null>;
    openMindWindow: (mindId: string) => Promise<void>;
    getAppBranding?: () => Promise<{ name: string; version: string }>;
    confirm?: (message: string) => Promise<boolean>;
  };
}
