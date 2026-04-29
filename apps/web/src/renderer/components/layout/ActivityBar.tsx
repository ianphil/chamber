import React from 'react';
import { useAppState, useAppDispatch } from '../../lib/store';
import { cn } from '../../lib/utils';
import { MessageSquare, Zap, Newspaper, Users, Clock, Settings, Layout, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import type { LensViewManifest } from '../../../shared/types';
import { UpdateIndicator } from './UpdateIndicator';

const iconMap: Record<string, LucideIcon> = {
  zap: Zap,
  newspaper: Newspaper,
  users: Users,
  clock: Clock,
  settings: Settings,
  layout: Layout,
  'message-square': MessageSquare,
};

function getIcon(iconName: string, size = 20): React.ReactNode {
  const Icon = iconMap[iconName] ?? Layout;
  return <Icon size={size} />;
}

export function ActivityBar() {
  const { activeView, discoveredViews, chatroomStreamingByMind } = useAppState();
  const dispatch = useAppDispatch();
  const isChatroomRunning = Object.values(chatroomStreamingByMind).some(Boolean);

  return (
    <div className="w-12 bg-card border border-border rounded-xl flex flex-col items-center py-2 shrink-0">
      <div className="flex flex-col items-center gap-1 flex-1">
        {/* Chat — always present */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Chat"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'chat'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <MessageSquare size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Chat</TooltipContent>
        </Tooltip>

        {/* Chatroom — always present */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Chatroom"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chatroom' })}
              className={cn(
                'relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'chatroom'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Users size={20} />
              {isChatroomRunning && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {isChatroomRunning ? 'Chatroom — agents running…' : 'Chatroom'}
          </TooltipContent>
        </Tooltip>

        {discoveredViews.length > 0 && <Separator className="my-1 w-8" />}

        {/* Discovered views */}
        {discoveredViews.map((view: LensViewManifest) => (
          <Tooltip key={view.id} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                aria-label={view.name}
                onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id })}
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                  activeView === view.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                {getIcon(view.icon)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{view.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Bottom-pinned settings */}
      <div data-testid="activity-bar-footer" className="flex flex-col items-center gap-1">
        <UpdateIndicator />
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              aria-label="Settings"
              onClick={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' })}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                activeView === 'settings'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <Settings size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
