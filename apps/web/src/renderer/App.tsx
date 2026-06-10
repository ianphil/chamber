import React from 'react';
import { AppStateProvider } from './lib/store';
import { AppShell } from './components/layout/AppShell';
import { GenesisGate } from './components/genesis/GenesisGate';
import { AuthGate } from './components/auth/AuthGate';
import { useAgentStatus } from './hooks/useAgentStatus';
import { ChamberPluginProvider } from './lib/plugin/ChamberPluginContext';
import { activeChamberPlugin } from './lib/plugin/activePlugin';

function AppWithGates() {
  useAgentStatus();
  return (
    <AuthGate>
      <GenesisGate>
        <AppShell />
      </GenesisGate>
    </AuthGate>
  );
}

export default function App() {
  return (
    <ChamberPluginProvider plugin={activeChamberPlugin}>
      <AppStateProvider>
        <AppWithGates />
      </AppStateProvider>
    </ChamberPluginProvider>
  );
}
