import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';

function ChatSideContent() {
  const { conversationId } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <div className="px-3 py-3 space-y-1">
      <button
        onClick={async () => {
          await window.electronAPI.chat.newConversation(conversationId);
          dispatch({ type: 'NEW_CONVERSATION' });
        }}
        className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors flex items-center gap-2"
      >
        <span className="text-muted-foreground">+</span>
        New conversation
      </button>
    </div>
  );
}

function LensViewSideContent() {
  const { activeView, discoveredViews } = useAppState();
  const view = discoveredViews.find(v => v.id === activeView);
  if (!view) return null;

  return (
    <div className="px-3 py-3 space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">View</p>
        <p className="text-sm font-medium">{view.name}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Type</p>
        <p className="text-xs">{view.view}</p>
      </div>
      {view.prompt && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{view.prompt}</p>
        </div>
      )}
    </div>
  );
}

export function SidePanel() {
  const { agentStatus, activeView } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <aside className="w-56 border-r border-border flex flex-col bg-card shrink-0">
      {/* Header: logo + status */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-genesis flex items-center justify-center text-sm font-bold text-primary-foreground">
            C
          </div>
          <div>
            <h1 className="text-sm font-semibold">Chamber</h1>
            <p className="text-xs text-muted-foreground">Agent Surface</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs">
          <div className={cn(
            'w-2 h-2 rounded-full',
            agentStatus.connected ? 'bg-genesis' : 'bg-destructive-foreground'
          )} />
          <span className="text-muted-foreground">
            {agentStatus.connected ? 'Mind loaded' : 'No mind selected'}
          </span>
        </div>
        {agentStatus.mindPath && (
          <p className="text-xs text-muted-foreground mt-1 truncate" title={agentStatus.mindPath}>
            {agentStatus.mindPath.split(/[\\/]/).pop()}
          </p>
        )}
      </div>

      {/* Middle: contextual content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeView === 'chat' ? <ChatSideContent /> : <LensViewSideContent />}
      </div>

      {/* Footer: switch agent */}
      <div className="px-3 py-3 border-t border-border">
        <button
          onClick={() => dispatch({ type: 'SHOW_LANDING' })}
          className="w-full px-3 py-2 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
        >
          Change your mind…
        </button>
      </div>
    </aside>
  );
}
