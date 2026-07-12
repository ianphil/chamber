import '@fontsource-variable/inter';
import './renderer/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/App';
import { installBrowserApi } from './browserApi';
import { startAppearanceSync } from './renderer/lib/appearanceStore';

installBrowserApi();
// Start app-wide appearance synchronization (theme, font scale, density) as the
// bundle loads and before React mounts, and keep the OS/cross-window listeners
// running for the whole session (not just while Settings is open).
//
// Note: this is a deferred ES module, so it runs after the document's first
// paint. `index.html` ships `class="dark"`, so default-dark users see the
// correct theme immediately, but a light/system-light user may see one dark
// frame on a cold load. A fuller fix (a render-blocking same-origin
// `theme-init` script in <head>, which the `script-src 'self'` CSP permits) is
// a possible follow-up; it is intentionally out of scope here.
startAppearanceSync();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
