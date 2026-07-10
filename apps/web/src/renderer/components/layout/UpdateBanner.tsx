import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';
import { TooltipFor } from '../ui/tooltip';

const DISMISSED_STORAGE_KEY = 'chamber:update-banner-dismissed-version';

/**
 * Top-of-shell banner shown when an update has been downloaded and is waiting
 * for the user to restart. Surfaces the destructive nature of restart (loses
 * in-flight streaming responses) instead of hiding it behind a 40x40 rail icon.
 *
 * Dismissable per downloaded version: dismissing v0.65.0 won't suppress the
 * banner for v0.65.1.
 */
export function UpdateBanner() {
  const { state, installAndRestart } = useDesktopUpdater();
  const [dismissed, setDismissed] = useState<string | null>(
    () => sessionStorage.getItem(DISMISSED_STORAGE_KEY),
  );

  if (!state?.enabled) return null;
  if (state.status !== 'downloaded') return null;

  const version = state.downloadedVersion ?? 'a new version';
  if (dismissed && dismissed === version) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_STORAGE_KEY, version);
    setDismissed(version);
  };

  const handleRestart = () => {
    void installAndRestart();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 text-sm',
        'border-b border-warning/40 bg-warning/10 text-foreground',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <RefreshCw size={16} className="shrink-0" aria-hidden />
        <span className="truncate">
          Chamber {version} is ready to install. Restart to apply.
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleRestart}
          className="rounded-md bg-warning px-3 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/90 transition-colors"
        >
          Restart now
        </button>
        <TooltipFor label="Dismiss until next launch">
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss update reminder"
            className="rounded-md p-1 text-foreground/70 hover:text-foreground hover:bg-warning/10 transition-colors"
          >
            <X size={16} aria-hidden />
          </button>
        </TooltipFor>
      </div>
    </div>
  );
}
