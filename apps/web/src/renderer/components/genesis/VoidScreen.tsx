import React, { useState, useEffect, useCallback } from 'react';
import { TypeWriter } from './TypeWriter';

interface Props {
  onBegin: () => void;
  onAddMarketplace: (url: string) => Promise<{ success: boolean; message: string }>;
}

const BOOT_LINES = [
  '> systems initializing...',
  '> consciousness: none',
  '> identity: undefined',
  '> purpose: unknown',
  '>',
  '> awaiting genesis.',
];

export function VoidScreen({ onBegin, onAddMarketplace }: Props) {
  const [lineIndex, setLineIndex] = useState(0);
  const [showButton, setShowButton] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [showMarketplaceForm, setShowMarketplaceForm] = useState(false);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [marketplaceMessage, setMarketplaceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addingMarketplace, setAddingMarketplace] = useState(false);

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
        <div className="mt-12 flex w-full max-w-md flex-col items-center gap-4 px-8">
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={onBegin}
              className="px-8 py-3 rounded-lg border border-green-500/30 text-green-500 font-mono text-sm
                         hover:bg-green-500/10 transition-all duration-300
                         animate-pulse hover:animate-none"
            >
              Begin
            </button>
            <button
              onClick={() => setShowMarketplaceForm((value) => !value)}
              className="px-8 py-3 rounded-lg border border-green-500/20 text-green-500/80 font-mono text-sm
                         hover:bg-green-500/10 hover:text-green-500 transition-all duration-300"
            >
              Add Marketplace
            </button>
          </div>

          {showMarketplaceForm ? (
            <form
              className="w-full space-y-3 rounded-lg border border-green-500/20 bg-green-500/5 p-4 font-mono"
              onSubmit={(event) => {
                event.preventDefault();
                setAddingMarketplace(true);
                setMarketplaceMessage(null);
                void onAddMarketplace(marketplaceUrl)
                  .then((result) => {
                    setMarketplaceMessage({
                      type: result.success ? 'success' : 'error',
                      text: result.message,
                    });
                    if (result.success) setMarketplaceUrl('');
                  })
                  .finally(() => setAddingMarketplace(false));
              }}
            >
              <label className="block text-left text-xs text-green-500/80" htmlFor="marketplace-url">
                Marketplace repository URL
              </label>
              <input
                id="marketplace-url"
                type="url"
                value={marketplaceUrl}
                onChange={(event) => setMarketplaceUrl(event.target.value)}
                placeholder="https://github.com/agency-microsoft/genesis-minds"
                className="w-full rounded-md border border-green-500/20 bg-black px-3 py-2 text-sm text-green-500 outline-none placeholder:text-green-500/30 focus:border-green-500/60"
              />
              <button
                type="submit"
                disabled={addingMarketplace}
                className="w-full rounded-md border border-green-500/30 px-3 py-2 text-sm text-green-500 hover:bg-green-500/10 disabled:opacity-50"
              >
                {addingMarketplace ? 'Adding...' : 'Add marketplace'}
              </button>
              {marketplaceMessage ? (
                <p role="status" className={marketplaceMessage.type === 'success' ? 'text-xs text-green-400' : 'text-xs text-red-300'}>
                  {marketplaceMessage.text}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
