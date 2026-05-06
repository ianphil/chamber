import React, { useEffect } from 'react';
import { useAppSubscriptions } from '../../hooks/useAppSubscriptions';
import { useAppDispatch, useAppState } from '../../lib/store';
import { TooltipProvider } from '../ui/tooltip';
import { ActivityBar } from './ActivityBar';
import { ConversationHistoryPanel } from '../history/ConversationHistoryPanel';
import { MacTitlebarDrag } from './MacTitlebarDrag';
import { MindSidebar } from './MindSidebar';
import { ViewRouter } from './ViewRouter';

function usePopoutParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    isPopout: params.get('popout') === 'true',
    popoutMindId: params.get('mindId'),
  };
}

export function AppShell() {
  useAppSubscriptions();
  const { isPopout, popoutMindId } = usePopoutParams();
  const { minds } = useAppState();
  const dispatch = useAppDispatch();

  // In popout mode, lock to the specified mind
  useEffect(() => {
    if (isPopout && popoutMindId && minds.length > 0) {
      dispatch({ type: 'SET_ACTIVE_MIND', payload: popoutMindId });
    }
  }, [isPopout, popoutMindId, minds.length, dispatch]);

  // Popout mode: just chat, no sidebar or activity bar
  if (isPopout) {
    return (
      <TooltipProvider>
        <MacTitlebarDrag />
        <div className="flex flex-col h-screen w-screen bg-background text-foreground">
          <div className="flex flex-1 min-h-0">
            <main className="flex-1 flex flex-col min-w-0">
              <ViewRouter />
            </main>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <MacTitlebarDrag />
      <div className="flex flex-col h-screen w-screen bg-background text-foreground">
        {/* Main layout: activity bar | mind sidebar | content | conversation history */}
        <div className="flex flex-1 min-h-0 gap-2 p-2">
          <ActivityBar />
          <MindSidebar />
          <main className="flex-1 flex flex-col min-w-0 bg-card border border-border rounded-xl overflow-hidden">
            <ViewRouter />
          </main>
          <ConversationHistoryPanel />
        </div>
      </div>
    </TooltipProvider>
  );
}
