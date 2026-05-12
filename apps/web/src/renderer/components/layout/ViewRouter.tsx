import React from 'react';
import { useAppState } from '../../lib/store';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatroomPanel } from '../chatroom/ChatroomPanel';
import { LensViewRenderer } from '../views/LensViewRenderer';
import { SettingsView } from '../settings/SettingsView';
import { A2ARelayView } from '../a2a/A2ARelayView';
import { SquadRoomPanel } from '../squad/SquadRoomPanel';

export function ViewRouter() {
  const { activeView, discoveredViews } = useAppState();

  if (activeView === 'chat') {
    return <ChatPanel />;
  }

  if (activeView === 'chatroom') {
    return <ChatroomPanel />;
  }

  if (activeView === 'squad') {
    return <SquadRoomPanel />;
  }

  if (activeView === 'settings') {
    return <SettingsView />;
  }

  if (activeView === 'a2a-relay') {
    return <A2ARelayView />;
  }

  const view = discoveredViews.find(v => v.id === activeView);
  if (view) {
    return <LensViewRenderer key={`${view.id}:${view.view}`} view={view} />;
  }

  // Fallback to chat if view not found
  return <ChatPanel />;
}
