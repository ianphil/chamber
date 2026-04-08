import React from 'react';

const STARTER_PROMPTS = [
  { emoji: '📋', label: 'Daily briefing', prompt: 'Give me my daily report' },
  { emoji: '🔍', label: 'Explore the mind', prompt: 'What do you know about? List your domains and expertise areas.' },
  { emoji: '📝', label: 'Check initiatives', prompt: 'What active initiatives are you tracking? Give me a status update.' },
  { emoji: '💡', label: 'What can you do?', prompt: 'What skills and capabilities do you have? How can you help me?' },
];

interface Props {
  onSendMessage: (message: string) => void;
  connected: boolean;
}

export function WelcomeScreen({ onSendMessage, connected }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center">
        {/* Genesis logo */}
        <div className="w-16 h-16 rounded-2xl bg-genesis flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto mb-6">
          G
        </div>

        <h2 className="text-2xl font-semibold mb-2">Genesis</h2>
        <p className="text-muted-foreground mb-8">
          {connected
            ? 'How can I help you today?'
            : 'Select a mind directory from the sidebar to get started.'}
        </p>

        {connected && (
          <div className="grid grid-cols-2 gap-3">
            {STARTER_PROMPTS.map((item) => (
              <button
                key={item.label}
                onClick={() => onSendMessage(item.prompt)}
                className="text-left p-3 rounded-xl border border-border hover:bg-accent transition-colors group"
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
