import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'chamber.theme';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Mark the document as "mid-swap" so the global color transition kicks
  // in just for this paint. We clear the class after the transition ends
  // so it doesn't interfere with per-component hover transitions.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  // Keep this aligned with THEME_MS (ambientScene.ts) and the 450ms CSS
  // color transition in index.css so the class clears as the crossfade ends.
  window.setTimeout(() => {
    root.classList.remove('theme-switching');
  }, 450);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable */
  }
  // Repaint the native Windows titleBarOverlay so the OS chrome stays
  // legible against the new app background.
  try {
    void window.desktop?.setTheme?.(theme);
  } catch {
    /* desktop bridge may not be present in browser smoke tests */
  }
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
        applyTheme(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
