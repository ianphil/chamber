import { shell } from 'electron';
import type { WebContents } from 'electron';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function shouldOpenExternally(targetUrl: string, currentUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (!EXTERNAL_PROTOCOLS.has(target.protocol)) return false;

  if (target.protocol === 'http:' || target.protocol === 'https:') {
    try {
      const current = new URL(currentUrl);
      if ((current.protocol === 'http:' || current.protocol === 'https:') && current.origin === target.origin) {
        return false;
      }
    } catch {
      // Treat malformed current URLs like packaged file URLs: web links are external.
    }
  }

  return true;
}

export function installExternalNavigationGuard(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url, webContents.getURL())) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!shouldOpenExternally(url, webContents.getURL())) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}

