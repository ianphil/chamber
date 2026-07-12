import '@fontsource-variable/inter';
import './renderer/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/App';
import { installBrowserApi } from './browserApi';
import { startAppearanceSync } from './renderer/lib/appearanceStore';

installBrowserApi();
// Start app-wide appearance synchronization (theme, font scale, density) before
// React mounts so a reload restores the user's choices without a flash and the
// OS/cross-window listeners run for the whole session, not just while Settings
// is open.
startAppearanceSync();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
