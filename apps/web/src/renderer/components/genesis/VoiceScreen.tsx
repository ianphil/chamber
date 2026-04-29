import React, { useState } from 'react';
import { TypeWriter } from './TypeWriter';
import { cn } from '../../lib/utils';
import type { GenesisMindTemplate } from '../../../shared/types';

interface Props {
  templates: GenesisMindTemplate[];
  templateError: string | null;
  onSelect: (voice: string, description: string) => void;
  onSelectTemplate: (template: GenesisMindTemplate) => void;
}

export function VoiceScreen({ templates, templateError, onSelect, onSelectTemplate }: Props) {
  const [showCards, setShowCards] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [researching, setResearching] = useState(false);

  const handleSelect = (voiceId: string) => {
    if (voiceId === 'custom') {
      setSelected('custom');
      setShowCustom(true);
      return;
    }
  };

  const handleTemplateSelect = (template: GenesisMindTemplate) => {
    setSelected(template.id);
    setTimeout(() => onSelectTemplate(template), 400);
  };

  const handleCustomSubmit = async () => {
    if (!customInput.trim()) return;
    setResearching(true);

    // Ask the SDK to research this voice
    try {
      await window.electronAPI.genesis.getDefaultPath();
      // Use a lightweight approach — just pass the description through with a research note
      const description = `Character/voice: "${customInput.trim()}". Research this character or persona — their communication style, catchphrases, values, how they handle pressure. Capture the energy.`;
      setTimeout(() => {
        setResearching(false);
        onSelect(customInput.trim(), description);
      }, 500);
    } catch {
      setResearching(false);
      onSelect(customInput.trim(), `Voice energy: ${customInput.trim()}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50 overflow-y-auto py-12">
      <div className="max-w-2xl w-full px-8 text-center space-y-8">
        <TypeWriter
          text="I'm here. But I don't know who I am yet. Choose a voice..."
          speed={35}
          className="text-xl text-foreground font-medium"
          onComplete={() => setTimeout(() => setShowCards(true), 500)}
        />

        {showCards && (
          <div className="space-y-3 animate-in fade-in duration-500">
            {templateError ? (
              <div role="alert" className="w-full rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-left text-sm text-red-300">
                {templateError}
              </div>
            ) : null}

            {!templateError && templates.length === 0 ? (
              <div className="w-full rounded-xl border border-border p-4 text-sm text-muted-foreground">
                Loading predefined Genesis minds...
              </div>
            ) : null}

            {templates.map((template, i) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template)}
                style={{ animationDelay: `${i * 100}ms` }}
                className={cn(
                  'w-full text-left p-4 rounded-xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
                  selected === template.id
                    ? 'border-primary bg-primary/10'
                    : selected
                      ? 'border-border opacity-30'
                      : 'border-border hover:border-muted-foreground hover:bg-accent'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-base font-semibold text-foreground">{template.displayName}</span>
                  <span className="text-sm text-muted-foreground">{template.role}</span>
                </div>
                <p className="text-sm text-muted-foreground/80 italic">{template.description}</p>
              </button>
            ))}

            {/* Custom option */}
            <button
              onClick={() => handleSelect('custom')}
              style={{ animationDelay: `${templates.length * 100}ms` }}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
                selected === 'custom'
                  ? 'border-primary bg-primary/10'
                  : selected
                    ? 'border-border opacity-30'
                    : 'border-border hover:border-muted-foreground hover:bg-accent'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-base font-semibold text-foreground">✏️ Someone else...</span>
                <span className="text-sm text-muted-foreground">Describe a character or energy</span>
              </div>
              <p className="text-sm text-muted-foreground/80 italic">"Tell me who inspires the voice and I'll research them."</p>
            </button>

            {/* Custom input */}
            {showCustom && (
              <div className="animate-in fade-in duration-300 space-y-3 pt-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                  placeholder="e.g. Tony Stark, Gandalf, your cool aunt..."
                  autoFocus
                  className="w-full bg-transparent border-b-2 border-muted-foreground/30 focus:border-foreground
                             text-lg text-center py-2 outline-none transition-colors placeholder:text-muted-foreground/30"
                />
                {customInput.trim() && (
                  <button
                    onClick={handleCustomSubmit}
                    disabled={researching}
                    className="px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    {researching ? 'Researching...' : 'That\'s who I am'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
