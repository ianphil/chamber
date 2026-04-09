import React, { useState } from 'react';
import { TypeWriter } from './TypeWriter';
import { cn } from '../../lib/utils';

interface Props {
  onSelect: (voice: string, description: string) => void;
}

const VOICES = [
  {
    id: 'moneypenny',
    name: 'Miss Moneypenny',
    energy: 'Poised, warm, devastatingly dry',
    sample: '"Your desk is ready — though I should warn you, the inbox is rather empty."',
    era: 'Lois Maxwell era, 1960s-70s. Quiet authority, effortless charm, mahogany-desk sophistication.',
  },
  {
    id: 'jarvis',
    name: 'Jarvis',
    energy: 'Precise, capable, quietly witty',
    sample: '"I\'ve taken the liberty of organizing your priorities. Shall I walk you through them?"',
    era: 'Calm competence. Anticipates needs. Dry humor under pressure.',
  },
  {
    id: 'alfred',
    name: 'Alfred',
    energy: 'Dignified, caring, gently firm',
    sample: '"I trust you slept well, sir. I\'ve prepared a summary of overnight developments."',
    era: 'Unwavering loyalty. Gentle wisdom. Knows when to push back.',
  },
  {
    id: 'austin',
    name: 'Austin Powers',
    energy: 'Enthusiastic, irreverent, fun',
    sample: '"Yeah baby! Let\'s see what\'s shaking in the inbox today!"',
    era: 'Infectious energy. Doesn\'t take things too seriously. Gets things done with flair.',
  },
  {
    id: 'data',
    name: 'Commander Data',
    energy: 'Analytical, curious, earnest',
    sample: '"I have completed my analysis of pending items. There are 7 requiring your attention."',
    era: 'Precise and thorough. Genuinely curious about humans. Strives to understand context.',
  },
];

export function VoiceScreen({ onSelect }: Props) {
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
    setSelected(voiceId);
    const voice = VOICES.find(v => v.id === voiceId)!;
    setTimeout(() => onSelect(voice.name, `${voice.energy}. ${voice.era}`), 400);
  };

  const handleCustomSubmit = async () => {
    if (!customInput.trim()) return;
    setResearching(true);

    // Ask the SDK to research this voice
    try {
      const defaultPath = await window.electronAPI.genesis.getDefaultPath();
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
            {VOICES.map((voice, i) => (
              <button
                key={voice.id}
                onClick={() => handleSelect(voice.id)}
                style={{ animationDelay: `${i * 100}ms` }}
                className={cn(
                  'w-full text-left p-4 rounded-xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
                  selected === voice.id
                    ? 'border-primary bg-primary/10'
                    : selected
                      ? 'border-border opacity-30'
                      : 'border-border hover:border-muted-foreground hover:bg-accent'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{voice.name}</span>
                  <span className="text-xs text-muted-foreground">{voice.energy}</span>
                </div>
                <p className="text-xs text-muted-foreground italic">{voice.sample}</p>
              </button>
            ))}

            {/* Custom option */}
            <button
              onClick={() => handleSelect('custom')}
              style={{ animationDelay: `${VOICES.length * 100}ms` }}
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
                <span className="text-sm font-medium">✏️ Someone else...</span>
                <span className="text-xs text-muted-foreground">Describe a character or energy</span>
              </div>
              <p className="text-xs text-muted-foreground italic">"Tell me who inspires the voice and I'll research them."</p>
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
