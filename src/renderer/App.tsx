import React from 'react';
import { AppStateProvider } from './lib/store';
import { AppShell } from './components/layout/AppShell';
import { GenesisGate } from './components/genesis/GenesisGate';
import { useAgentStatus } from './hooks/useAgentStatus';

function AppWithGate() {
  useAgentStatus();
  return (
    <GenesisGate>
      <AppShell />
    </GenesisGate>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppWithGate />
    </AppStateProvider>
  );
}
