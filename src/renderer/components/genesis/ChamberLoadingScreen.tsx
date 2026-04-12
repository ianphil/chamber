import React, { useState, useEffect } from 'react';

const BOOT_LINES = [
  '> chamber v0.15.0',
  '> initializing runtime...',
  '> scanning mind registry...',
];

export function ChamberLoadingScreen() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < BOOT_LINES.length) {
        setLines(prev => [...prev, BOOT_LINES[i]]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, []);

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
        <p className="text-xs text-green-500/50 font-mono">waking agents...</p>
      </div>
    </div>
  );
}
