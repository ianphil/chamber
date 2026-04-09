import React, { useState, useEffect, useCallback } from 'react';
import { TypeWriter } from './TypeWriter';

interface Props {
  onBegin: () => void;
}

const BOOT_LINES = [
  '> systems initializing...',
  '> consciousness: none',
  '> identity: undefined',
  '> purpose: unknown',
  '>',
  '> awaiting genesis.',
];

export function VoidScreen({ onBegin }: Props) {
  const [lineIndex, setLineIndex] = useState(0);
  const [showButton, setShowButton] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  const handleLineComplete = useCallback(() => {
    if (lineIndex < BOOT_LINES.length - 1) {
      setTimeout(() => setLineIndex(i => i + 1), 400);
    } else {
      setTimeout(() => setShowButton(true), 800);
    }
  }, [lineIndex]);

  useEffect(() => {
    if (lineIndex < BOOT_LINES.length) {
      setLines(prev => [...prev, BOOT_LINES[lineIndex]]);
    }
  }, [lineIndex]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50">
      <div className="font-mono text-sm text-green-500 space-y-1 max-w-md w-full px-8">
        {lines.map((line, i) => (
          <div key={i}>
            {i === lineIndex && i < BOOT_LINES.length ? (
              <TypeWriter
                text={line}
                speed={40}
                onComplete={handleLineComplete}
                className="text-green-500"
              />
            ) : (
              <span>{line}</span>
            )}
          </div>
        ))}
      </div>

      {showButton && (
        <button
          onClick={onBegin}
          className="mt-12 px-8 py-3 rounded-lg border border-green-500/30 text-green-500 font-mono text-sm
                     hover:bg-green-500/10 transition-all duration-300
                     animate-pulse hover:animate-none"
        >
          Begin
        </button>
      )}
    </div>
  );
}
