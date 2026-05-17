import React, { useEffect, useState } from 'react';
import { APP_VERSION } from '@/renderer/lib/appVersion';
import type { StartupProgressEvent } from '@chamber/shared/types';

const STARTUP_LINES = [
  `> chamber v${APP_VERSION}`,
  '> initializing runtime...',
  '> scanning mind registry...',
];

function getBootLines(mode: 'startup' | 'switching-account', login?: string | null): string[] {
  if (mode === 'switching-account') {
    return [
      `> chamber v${APP_VERSION}`,
      `> switching github account${login ? ` to @${login}` : ''}...`,
      '> reloading minds...',
    ];
  }

  return STARTUP_LINES;
}

function formatStartupEvent(event: StartupProgressEvent): string {
  switch (event.kind) {
    case 'restore-start':
      return `> ${event.detail}`;
    case 'mind-restoring':
      return `>   waking ${event.detail}...`;
    case 'mind-restored':
      return `>   ${event.detail} ready`;
    case 'mind-failed':
      return `>   ! failed to restore ${event.detail}`;
    case 'restore-complete':
      return `> ${event.detail}`;
    default:
      return `> ${event.detail}`;
  }
}

interface Props {
  mode?: 'startup' | 'switching-account';
  login?: string | null;
}

export function ChamberLoadingScreen({ mode = 'startup', login }: Props) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const bootLines = getBootLines(mode, login);
    setLines([]);
    let i = 0;
    const interval = setInterval(() => {
      if (i < bootLines.length) {
        const line = bootLines[i];
        setLines(prev => [...prev, line]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [login, mode]);

  // Subscribe to real app-startup progress (#56) so the user sees actual
  // activity once the main process starts restoring minds. The fake boot
  // lines above keep the early frames lively while we wait for the first
  // real event; real events stream in alongside them.
  useEffect(() => {
    if (mode !== 'startup') return undefined;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.app?.onStartupProgress) return undefined;
    const unsubscribe = api.app.onStartupProgress((event) => {
      setLines((prev) => [...prev, formatStartupEvent(event)]);
    });
    return unsubscribe;
  }, [mode]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50">
      <div className="font-mono text-sm text-green-500 space-y-1 max-w-md w-full px-8">
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        <span className="animate-pulse">▊</span>
      </div>

      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
        <p className="text-xs text-green-500/50 font-mono">
          {mode === 'switching-account' ? 'switching account and waking agents...' : 'waking agents...'}
        </p>
      </div>
    </div>
  );
}
