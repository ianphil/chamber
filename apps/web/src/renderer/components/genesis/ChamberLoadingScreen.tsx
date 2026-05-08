import React, { useState, useEffect } from 'react';
import { APP_VERSION } from '@/renderer/lib/appVersion';

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
