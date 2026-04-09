import React, { useState, useEffect, useRef } from 'react';

interface Props {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
  cursor?: boolean;
}

export function TypeWriter({ text, speed = 50, onComplete, className = '', cursor = true }: Props) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    const interval = setInterval(() => {
      indexRef.current++;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
        onComplete?.();
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return (
    <span className={className}>
      {displayed}
      {cursor && !done && <span className="animate-pulse">▊</span>}
    </span>
  );
}
