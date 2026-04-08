import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

