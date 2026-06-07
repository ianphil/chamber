import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, RefreshCw, Rocket, RotateCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';

// How long to surface "Just checked - up to date" feedback after a user-
// initiated check resolves with no available update.
const JUST_CHECKED_MS = 3000;

export function UpdateIndicator() {
  const { state, check, download, installAndRestart } = useDesktopUpdater();
  const [justChecked, setJustChecked] = useState(false);
  const userCheckPendingRef = useRef(false);
  const justCheckedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When a user-initiated check resolves with up-to-date, show transient
  // confirmation so the click doesn't feel like a no-op.
  useEffect(() => {
    if (!state) return;
    if (!userCheckPendingRef.current) return;
    if (state.status === 'checking') return;

    userCheckPendingRef.current = false;
    if (state.status === 'up-to-date') {
      setJustChecked(true);
      if (justCheckedTimerRef.current) clearTimeout(justCheckedTimerRef.current);
      justCheckedTimerRef.current = setTimeout(() => setJustChecked(false), JUST_CHECKED_MS);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (justCheckedTimerRef.current) clearTimeout(justCheckedTimerRef.current);
    };
  }, []);

  if (!state?.enabled) return null;

  const isBusy = state.status === 'checking'
    || state.status === 'downloading'
    || state.status === 'installing';
  const canAct = !isBusy;
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
    userCheckPendingRef.current = true;
    setJustChecked(false);
    void check();
  };

  const Icon = justChecked
    ? Check
    : state.status === 'available'
      ? Download
      : state.status === 'downloaded'
        ? Rocket
        : state.status === 'error'
          ? RotateCw
          : RefreshCw;

  const label = justChecked
    ? "You're up to date"
    : state.status === 'available'
      ? `Download Chamber ${state.availableVersion}`
      : state.status === 'downloaded'
        ? `Restart to install Chamber ${state.downloadedVersion}`
        : state.status === 'downloading'
          ? `Downloading update${percent === null ? '' : ` ${percent}%`}`
          : state.status === 'up-to-date'
            ? 'Check for updates'
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
            'relative w-10 h-10 rounded-lg flex flex-col items-center justify-center transition-colors',
            justChecked
              ? 'text-green-400 hover:text-green-300 hover:bg-green-400/10'
              : state.status === 'available' || state.status === 'downloaded'
                ? 'text-yellow-300 hover:text-yellow-200 hover:bg-yellow-400/10'
                : state.status === 'error'
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            isBusy && 'opacity-70 cursor-wait',
            state.status === 'up-to-date' && !justChecked && 'opacity-50',
          )}
        >
          <Icon size={20} className={isBusy && !percent ? 'animate-spin' : undefined} />
          {state.status === 'downloading' && percent !== null && (
            <span className="absolute bottom-0.5 left-0 right-0 text-[9px] font-medium tabular-nums leading-none text-center">
              {percent}%
            </span>
          )}
          {!isBusy && (state.status === 'available' || state.status === 'downloaded') && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-yellow-300" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}
