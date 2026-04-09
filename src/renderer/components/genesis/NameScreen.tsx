import React, { useState, useRef, useEffect } from 'react';
import { TypeWriter } from './TypeWriter';

interface Props {
  onSubmit: (name: string) => void;
}

export function NameScreen({ onSubmit }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleSubmit = () => {
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50 transition-colors duration-1000">
      <div className="max-w-md w-full px-8 text-center space-y-8">
        <div className="space-y-2 text-muted-foreground">
          <TypeWriter
            text="I'm... here. But I don't know who I am yet."
            speed={35}
            className="text-lg"
          />
        </div>

        <div>
          <TypeWriter
            text="What should I be called?"
            speed={35}
            className="text-xl text-foreground font-medium"
            onComplete={() => setTimeout(() => setShowInput(true), 500)}
          />
        </div>

        {showInput && (
          <div className="animate-in fade-in duration-500">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Enter a name..."
              className="w-full bg-transparent border-b-2 border-muted-foreground/30 focus:border-foreground
                         text-2xl text-center py-3 outline-none transition-colors placeholder:text-muted-foreground/30"
            />
            {name.trim() && (
              <button
                onClick={handleSubmit}
                className="mt-6 px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-80 transition-opacity"
              >
                That's me
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
