import React from 'react';

const STARTER_PROMPTS = [
  { emoji: '📋', label: 'Daily briefing', prompt: 'Give me my daily report' },
  { emoji: '🔍', label: 'Explore the mind', prompt: 'What do you know about? List your domains and expertise areas.' },
  { emoji: '📝', label: 'Check initiatives', prompt: 'What active initiatives are you tracking? Give me a status update.' },
  { emoji: '🔮', label: 'Create a Lens', prompt: 'Create a new Lens view for me. What data would you like to visualize? Suggest some options based on what you know about this mind.' },
  { emoji: '💡', label: 'What can you do?', prompt: 'What skills and capabilities do you have? How can you help me?' },
  { emoji: '🆕', label: 'What\'s new?', prompt: 'Tell me about the Lens view framework. What view types are available? How do I create a new view? What can I do with the action bar on each view?' },
];

interface Props {
  onSendMessage: (message: string) => void;
  connected: boolean;
  disabled?: boolean;
}

export function WelcomeScreen({ onSendMessage, connected, disabled = false }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center">
        {/* Chamber logo */}
        <div className="w-16 h-16 rounded-2xl bg-genesis flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-6">
          C
        </div>

        <h2 className="text-2xl font-semibold mb-2">Chamber</h2>
        <p className="text-muted-foreground mb-8">
          {connected
            ? 'How can I help you today?'
            : 'Select a mind directory from the sidebar to get started.'}
        </p>

        {connected && (
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            {STARTER_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={disabled}
                onClick={() => onSendMessage(item.prompt)}
                className="text-left p-3 rounded-xl border border-border hover:bg-accent transition-colors group disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="text-lg mb-1 block">{item.emoji}</span>
                <span className="text-sm font-medium group-hover:text-foreground">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
