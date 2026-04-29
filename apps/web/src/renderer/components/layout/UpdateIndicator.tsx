import React from 'react';
import { Download, RefreshCw, Rocket, RotateCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';

export function UpdateIndicator() {
  const { state, check, download, installAndRestart } = useDesktopUpdater();

  if (!state?.enabled) return null;

  const isBusy = state.status === 'checking'
    || state.status === 'downloading'
    || state.status === 'installing';
  const canAct = !isBusy && state.status !== 'up-to-date';
  const percent = typeof state.downloadPercent === 'number'
    ? Math.round(state.downloadPercent)
    : null;

  const handleClick = () => {
    if (isBusy) return;
    if (state.status === 'available') {
      void download();
      return;
    }
    if (state.status === 'downloaded') {
      void installAndRestart();
      return;
    }
    void check();
  };

  const Icon = state.status === 'available'
    ? Download
    : state.status === 'downloaded'
      ? Rocket
      : state.status === 'error'
        ? RotateCw
        : RefreshCw;

  const label = state.status === 'available'
    ? `Download Chamber ${state.availableVersion}`
    : state.status === 'downloaded'
      ? `Restart to install Chamber ${state.downloadedVersion}`
      : state.status === 'downloading'
        ? `Downloading update${percent === null ? '' : ` ${percent}%`}`
        : state.message ?? 'Check for updates';

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={handleClick}
          disabled={!canAct}
          className={cn(
            'relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
            state.status === 'available' || state.status === 'downloaded'
              ? 'text-yellow-300 hover:text-yellow-200 hover:bg-yellow-400/10'
              : state.status === 'error'
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            isBusy && 'opacity-70 cursor-wait',
            state.status === 'up-to-date' && 'opacity-50',
          )}
        >
          <Icon size={20} className={isBusy ? 'animate-spin' : undefined} />
          {(state.status === 'available' || state.status === 'downloaded') && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-yellow-300" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}
