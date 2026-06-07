// Ambient declarations for non-code side-effect imports in the renderer bundle.
// Vite handles these at build time; TS needs the module shapes to type-check.

declare module '*.css';
declare module '@fontsource-variable/inter';

interface Window {
  desktop?: {
    pickFolder: () => Promise<string | null>;
    openMindWindow: (mindId: string) => Promise<void>;
    getAppBranding?: () => Promise<{ name: string; version: string }>;
    confirm?: (message: string) => Promise<boolean>;
    setTheme?: (theme: 'light' | 'dark') => Promise<void>;
    window?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  };
}
