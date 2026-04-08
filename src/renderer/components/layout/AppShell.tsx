import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { ChatPanel } from '../chat/ChatPanel';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const { agentStatus } = useAppState();

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* Titlebar drag region */}
      <div className="titlebar-drag fixed top-0 left-0 right-0 h-9 z-50" />

      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <ChatPanel />
      </main>
    </div>
  );
}
