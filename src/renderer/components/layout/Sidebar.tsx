import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { cn } from '../../lib/utils';

export function Sidebar() {
  const { agentStatus } = useAppState();
  const dispatch = useAppDispatch();
  const { selectMindDirectory } = useAgentStatus();

  return (
    <aside className="w-64 border-r border-border flex flex-col bg-card pt-9 shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border titlebar-no-drag">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-genesis flex items-center justify-center text-sm font-bold text-primary-foreground">
            G
          </div>
          <div>
            <h1 className="text-sm font-semibold">Genesis</h1>
            <p className="text-xs text-muted-foreground">Mind Interface</p>
          </div>
        </div>
      </div>

      {/* Connection status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs">
          <div className={cn(
            'w-2 h-2 rounded-full',
            agentStatus.connected ? 'bg-genesis' : 'bg-destructive-foreground'
          )} />
          <span className="text-muted-foreground">
            {agentStatus.connected ? 'Connected' : 'No mind selected'}
          </span>
        </div>
        {agentStatus.mindPath && (
          <p className="text-xs text-muted-foreground mt-1 truncate" title={agentStatus.mindPath}>
            {agentStatus.mindPath.split(/[\\/]/).pop()}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-1 px-3 py-3 space-y-1">
        <button
          onClick={() => dispatch({ type: 'NEW_CONVERSATION' })}
          className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors flex items-center gap-2"
        >
          <span className="text-muted-foreground">+</span>
          New conversation
        </button>
      </div>

      {/* Mind selector */}
      <div className="px-3 py-3 border-t border-border">
        <button
          onClick={selectMindDirectory}
          className="w-full px-3 py-2 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
        >
          {agentStatus.connected ? 'Change mind directory…' : 'Select mind directory…'}
        </button>
      </div>
    </aside>
  );
}
