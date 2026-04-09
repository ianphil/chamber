import React, { useState, useEffect, useRef } from 'react';

interface Props {
  name: string;
  role: string;
  onComplete: () => void;
}

export function BootScreen({ name, role, onComplete }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0); // 0 to 100
  const completeRef = useRef(false);

  // Show initial boot lines
  useEffect(() => {
    const initialLines = [
      `> writing SOUL.md...`,
      `> identity: ${name}`,
      `> purpose: ${role}`,
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < initialLines.length) {
        setLines(prev => [...prev, initialLines[i]]);
        i++;
        setProgress(p => Math.min(p + 10, 30));
      } else {
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [name, role]);

  // Listen for real progress from main process
  useEffect(() => {
    const unsub = window.electronAPI.genesis.onProgress((prog) => {
      if (prog.step === 'structure') {
        setProgress(20);
      }
      if (prog.step === 'soul') {
        setLines(prev => [...prev, '> voice: calibrating...']);
        setProgress(40);
      }
      if (prog.step === 'validate') {
        setLines(prev => [...prev, '> voice: calibrated', '> memory: initialized']);
        setProgress(70);
      }
      if (prog.step === 'git') {
        setLines(prev => [...prev, '> inbox: ready', '> domains: empty — awaiting first briefing']);
        setProgress(90);
      }
      if (prog.step === 'complete') {
        setLines(prev => [...prev, '>', '> genesis complete.']);
        setProgress(100);
        if (!completeRef.current) {
          completeRef.current = true;
          setTimeout(onComplete, 1500);
        }
      }
    });
    return () => { unsub(); };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50">
      <div className="font-mono text-sm text-green-500 space-y-1 max-w-md w-full px-8">
        {lines.map((line, i) => (
          <div
            key={i}
            className={line === '> genesis complete.' ? 'text-green-400 font-bold mt-2' : ''}
          >
            {line}
          </div>
        ))}
        {!completeRef.current && (
          <span className="animate-pulse">▊</span>
        )}
      </div>

      {/* Spinner */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        {progress < 100 ? (
          <>
            <div className="w-6 h-6 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
            <p className="text-xs text-green-500/50 font-mono">creating your agent...</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
