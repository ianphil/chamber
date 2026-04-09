import React, { useState } from 'react';
import { TypeWriter } from './TypeWriter';
import { cn } from '../../lib/utils';

interface Props {
  name: string;
  onSelect: (role: string) => void;
}

const ROLES = [
  { emoji: '🎯', label: 'Chief of Staff', description: 'I run the operation', id: 'chief-of-staff' },
  { emoji: '🔬', label: 'Research Partner', description: 'I dig deep on hard problems', id: 'research-partner' },
  { emoji: '🛠️', label: 'Engineering Partner', description: 'I build things with you', id: 'engineering-partner' },
  { emoji: '✏️', label: 'Something else...', description: 'Tell me', id: 'custom' },
];

export function RoleScreen({ name, onSelect }: Props) {
  const [showCards, setShowCards] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (roleId: string) => {
    setSelected(roleId);
    setTimeout(() => {
      const role = ROLES.find(r => r.id === roleId);
      onSelect(role?.label ?? roleId);
    }, 300);
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50">
      <div className="max-w-lg w-full px-8 text-center space-y-8">
        <TypeWriter
          text={`And what am I, ${name}? What's my purpose?`}
          speed={35}
          className="text-xl text-foreground font-medium"
          onComplete={() => setTimeout(() => setShowCards(true), 500)}
        />

        {showCards && (
          <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-500">
            {ROLES.map((role, i) => (
              <button
                key={role.id}
                onClick={() => handleSelect(role.id)}
                style={{ animationDelay: `${i * 100}ms` }}
                className={cn(
                  'text-left p-4 rounded-xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
                  selected === role.id
                    ? 'border-primary bg-primary/10 scale-105'
                    : selected
                      ? 'border-border opacity-40 scale-95'
                      : 'border-border hover:border-muted-foreground hover:bg-accent'
                )}
              >
                <span className="text-2xl block mb-2">{role.emoji}</span>
                <span className="text-sm font-medium block">{role.label}</span>
                <span className="text-xs text-muted-foreground">{role.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
