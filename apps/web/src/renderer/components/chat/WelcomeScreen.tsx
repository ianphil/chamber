import React from 'react';
import { FileText, Compass, ListChecks, Sparkles, Lightbulb, Megaphone, type LucideIcon } from 'lucide-react';

const STARTER_PROMPTS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: FileText, label: 'Daily briefing', prompt: 'Give me my daily report' },
  { icon: Compass, label: 'Explore the mind', prompt: 'What do you know about? List your domains and expertise areas.' },
  { icon: ListChecks, label: 'Check initiatives', prompt: 'What active initiatives are you tracking? Give me a status update.' },
  { icon: Sparkles, label: 'Create a Lens', prompt: 'Create a new Lens view for me. What data would you like to visualize? Suggest some options based on what you know about this mind.' },
  { icon: Lightbulb, label: 'What can you do?', prompt: 'What skills and capabilities do you have? How can you help me?' },
  { icon: Megaphone, label: 'What\'s new?', prompt: 'Tell me about the Lens view framework. What view types are available? How do I create a new view? What can I do with the action bar on each view?' },
];

interface Props {
  onPickPrompt: (prompt: string) => void;
  connected: boolean;
  disabled?: boolean;
}

export function WelcomeScreen({ onPickPrompt, connected, disabled = false }: Props) {
  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center">
        {/* Chamber logo */}
        <div className="glow-genesis w-16 h-16 rounded-2xl bg-gradient-to-br from-genesis to-[oklch(0.46_0.14_165)] flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-6">
          C
        </div>

        <h2 className="text-2xl font-semibold mb-2 tracking-tight">Chamber</h2>
        <p className="text-muted-foreground mb-2">
          {connected
            ? 'How can I help you today?'
            : 'Select a mind directory from the sidebar to get started.'}
        </p>

        {connected && (
          <>
            <p className="text-xs text-foreground/50 mb-6">
              Click a starter to stage the prompt in the composer below. Edit it before sending.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-xl">
              {STARTER_PROMPTS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickPrompt(item.prompt)}
                    className="surface-card surface-card-hover text-left p-3 rounded-xl border border-border bg-card group transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <Icon className="w-5 h-5 mb-2 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="text-sm font-medium group-hover:text-foreground">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
