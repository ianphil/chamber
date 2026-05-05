import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Plus, X, Bot, MessageSquarePlus, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { MindContext } from '@chamber/shared/types';

const MIN_WIDTH = 140;
const MAX_WIDTH = 400;
const STORAGE_KEY = 'chamber:sidebarWidth';

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
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved, 10))) : 192;
  });
  const isResizing = useRef(false);

  const handleAddMind = async () => {
    dispatch({ type: 'SHOW_LANDING' });
  };

  const handleSwitchMind = (mind: MindContext) => {
    if (mind.windowed) {
      // Focus the popout window instead of switching in main
      window.electronAPI.mind.openWindow(mind.mindId);
    } else {
      window.electronAPI.mind.setActive(mind.mindId);
      dispatch({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
    }
  };

  const handlePopout = async (e: React.MouseEvent, mindId: string) => {
    e.stopPropagation();
    await window.electronAPI.mind.openWindow(mindId);
  };

  const handleRemoveMind = async (e: React.MouseEvent, mindId: string) => {
    e.stopPropagation();
    await window.electronAPI.mind.remove(mindId);
    dispatch({ type: 'REMOVE_MIND', payload: mindId });
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  if (minds.length === 0) return null;

  return (
    <div className="relative bg-card border border-border rounded-xl overflow-hidden flex flex-col shrink-0" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 active:bg-accent z-10"
      />
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Agents
      </div>

      <div className="flex-1 overflow-y-auto">
        {minds.map((mind) => (
          <button
            key={mind.mindId}
            onClick={() => handleSwitchMind(mind)}
            className={cn(
              'w-full px-3 py-2 flex items-center gap-2 text-sm transition-colors group',
              mind.windowed
                ? 'text-muted-foreground/60 italic'
                : mind.mindId === activeMindId
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <Bot size={16} className="shrink-0" />
            <div className={cn('w-2 h-2 rounded-full shrink-0', statusColor(mind.status))} />
            <span className="truncate flex-1 text-left">{mind.identity.name}</span>
            {mind.windowed ? (
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground/50">
                    <ExternalLink size={12} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">In separate window</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => handlePopout(e, mind.mindId)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                    >
                      <ExternalLink size={12} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">Open in window</TooltipContent>
                </Tooltip>
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
              </>
            )}
          </button>
        ))}
      </div>

      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={async () => {
            if (activeMindId) {
              await window.electronAPI.chat.newConversation(activeMindId);
              await window.electronAPI.chatroom.clear();
              dispatch({ type: 'NEW_CONVERSATION' });
              dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
            }
          }}
          disabled={!activeMindId}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <MessageSquarePlus size={14} />
          New Conversation
        </button>
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
