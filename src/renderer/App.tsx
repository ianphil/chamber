import React from 'react';
import { AppStateProvider } from './lib/store';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  );
}
