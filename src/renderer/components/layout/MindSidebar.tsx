import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Plus, X, Bot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { MindContext } from '../../../shared/types';

function statusColor(status: MindContext['status']): string {
  switch (status) {
    case 'ready': return 'bg-green-500';
    case 'loading': return 'bg-yellow-500 animate-pulse';
    case 'error': return 'bg-red-500';
    case 'unloading': return 'bg-gray-400';
    default: return 'bg-gray-400';
  }
}

export function MindSidebar() {
  const { minds, activeMindId } = useAppState();
  const dispatch = useAppDispatch();

  const handleAddMind = async () => {
    dispatch({ type: 'SHOW_LANDING' });
  };

  const handleSwitchMind = (mindId: string) => {
    window.electronAPI.mind.setActive(mindId);
    dispatch({ type: 'SET_ACTIVE_MIND', payload: mindId });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  };

  const handleRemoveMind = async (e: React.MouseEvent, mindId: string) => {
    e.stopPropagation();
    await window.electronAPI.mind.remove(mindId);
    dispatch({ type: 'REMOVE_MIND', payload: mindId });
  };

  if (minds.length === 0) return null;

  return (
    <div className="w-48 bg-card/50 border-r border-border flex flex-col shrink-0">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Agents
      </div>

      <div className="flex-1 overflow-y-auto">
        {minds.map((mind) => (
          <button
            key={mind.mindId}
            onClick={() => handleSwitchMind(mind.mindId)}
            className={cn(
              'w-full px-3 py-2 flex items-center gap-2 text-sm transition-colors group',
              mind.mindId === activeMindId
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <Bot size={16} className="shrink-0" />
            <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor(mind.status))} />
            <span className="truncate flex-1 text-left">{mind.identity.name}</span>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <span
                  role="button"
                  onClick={(e) => handleRemoveMind(e, mind.mindId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                >
                  <X size={14} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">Remove agent</TooltipContent>
            </Tooltip>
          </button>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <button
          onClick={handleAddMind}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded flex items-center gap-2 transition-colors"
        >
          <Plus size={14} />
          Add Agent
        </button>
      </div>
    </div>
  );
}
