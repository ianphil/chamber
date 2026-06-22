/// <reference types="vite/client" />
// Ambient declarations for non-code side-effect imports in the renderer bundle.
// Vite handles these at build time; TS needs the module shapes to type-check.
// The vite/client reference above augments `ImportMeta` with `hot`/`env` so the
// HMR block in AmbientCanvas type-checks under the root (non-web) tsconfig too.

declare module '*.css';
declare module '@fontsource-variable/inter';

interface Window {
  desktop?: {
    pickFolder: () => Promise<string | null>;
    openMindWindow: (mindId: string) => Promise<void>;
    getAppBranding?: () => Promise<{ name: string; version: string }>;
    confirm?: (message: string) => Promise<boolean>;
    setTheme?: (theme: 'light' | 'dark') => Promise<void>;
  };
}
