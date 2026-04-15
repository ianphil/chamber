import React from 'react';
import { useAppState } from '../../lib/store';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatroomPanel } from '../chatroom/ChatroomPanel';
import { LensViewRenderer } from '../views/LensViewRenderer';
import { SettingsView } from '../settings/SettingsView';

export function ViewRouter() {
  const { activeView, discoveredViews } = useAppState();

  if (activeView === 'chat') {
    return <ChatPanel />;
  }

  if (activeView === 'chatroom') {
    return <ChatroomPanel />;
  }

  if (activeView === 'settings') {
    return <SettingsView />;
  }

  const view = discoveredViews.find(v => v.id === activeView);
  if (view) {
    return <LensViewRenderer key={view.id} view={view} />;
  }

  // Fallback to chat if view not found
  return <ChatPanel />;
}
