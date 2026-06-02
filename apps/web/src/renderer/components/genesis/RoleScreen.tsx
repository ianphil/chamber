import React, { useState, useRef, useEffect } from 'react';
import { TypeWriter } from './TypeWriter';
import { cn } from '../../lib/utils';
import { useAppState } from '../../lib/store';

interface Props {
  name: string;
  /**
   * v0.60.0 Phase 2: signature changed from `(role: string)` to
   * `(role: string, enableDreamDaemon: boolean)`. The boolean is captured
   * from the dream-daemon Switch at the bottom of this screen — Role is the
   * last input the user makes before `genesis.create` fires, so colocating
   * the Switch here means GenesisFlow can forward the choice into the IPC
   * payload without an extra screen or extra state hop.
   */
  onSelect: (role: string, enableDreamDaemon: boolean) => void;
}

const ROLES = [
  { emoji: '🎯', label: 'Chief of Staff', description: 'I run the operation', id: 'chief-of-staff' },
  { emoji: '🔬', label: 'Research Partner', description: 'I dig deep on hard problems', id: 'research-partner' },
  { emoji: '🛠️', label: 'Engineering Partner', description: 'I build things with you', id: 'engineering-partner' },
  { emoji: '✏️', label: 'Something else...', description: 'Tell me', id: 'custom' },
];

export function RoleScreen({ name, onSelect }: Props) {
  const { featureFlags } = useAppState();
  const dreamDaemonFlag = featureFlags.dreamDaemon;
  const [showCards, setShowCards] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [customRole, setCustomRole] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  // Strict opt-in. Defaults to OFF so a user who never touches the Switch
  // ends up with a quiet mind. The dream daemon never starts, log.md stays
  // empty, and `.chamber.json` is never written — see MindScaffold.createStructure.
  const [enableDreamDaemon, setEnableDreamDaemon] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showCustomInput) return;
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [showCustomInput]);

  // Defense-in-depth: even if a stale component state held `true` from
  // before the flag flipped off, never forward an opt-in when the
  // feature flag is disabled. The IPC layer also coerces this server-side.
  const effectiveDreamDaemon = dreamDaemonFlag && enableDreamDaemon;

  const handleSelect = (roleId: string) => {
    if (roleId === 'custom') {
      setSelected('custom');
      setShowCustomInput(true);
      return;
    }
    setSelected(roleId);
    setTimeout(() => {
      const role = ROLES.find(r => r.id === roleId);
      onSelect(role?.label ?? roleId, effectiveDreamDaemon);
    }, 300);
  };

  const handleCustomSubmit = () => {
    const role = customRole.trim();
    if (!role) return;
    onSelect(role, effectiveDreamDaemon);
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
          <div className="space-y-3 animate-in fade-in duration-500">
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map((role, i) => (
                <button
                  key={role.id}
                  onClick={() => handleSelect(role.id)}
                  style={{ animationDelay: `${i * 100}ms` }}
                  className={cn(
                    'text-left text-foreground p-4 rounded-xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
                    selected === role.id
                      ? 'border-primary bg-primary/10 scale-105'
                      : selected
                        ? 'border-border opacity-40 scale-95'
                        : 'border-border hover:border-muted-foreground hover:bg-accent'
                  )}
                >
                  <span className="text-2xl block mb-2">{role.emoji}</span>
                  <span className="text-sm font-medium text-foreground block">{role.label}</span>
                  <span className="text-xs text-muted-foreground">{role.description}</span>
                </button>
              ))}
            </div>

            {showCustomInput && (
              <div className="animate-in fade-in duration-300 space-y-3 pt-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                  placeholder="e.g. Creative Director, Debate Coach, Writing Partner..."
                  className="w-full bg-transparent border-b-2 border-muted-foreground/30 focus:border-foreground
                             text-lg text-center text-foreground py-2 outline-none transition-colors placeholder:text-muted-foreground/30"
                />
                {customRole.trim() && (
                  <button
                    onClick={handleCustomSubmit}
                    className="px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-80 transition-opacity"
                  >
                    That's my purpose
                  </button>
                )}
              </div>
            )}

            {/*
              Dream-daemon opt-in. Sits at the bottom because it's a
              secondary, optional choice — the role cards are the primary
              decision. ARIA `switch` role + `aria-checked` is the WCAG-
              recommended shape for an on/off toggle (better than a raw
              checkbox here because the binary state is the whole UI).
              Gated behind the app-level `dreamDaemon` feature flag: when
              off, the Switch is hidden entirely so genesis creates a
              quiet mind regardless of `.chamber.json` state.
            */}
            {dreamDaemonFlag && (
              <div className="pt-6 border-t border-border/50 flex items-center justify-between gap-4 text-left">
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">Enable dream daemon</div>
                  <div className="text-xs text-muted-foreground">
                    Background memory consolidation. Off by default — you can change this later.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enableDreamDaemon}
                  aria-label="Enable dream daemon"
                  onClick={() => setEnableDreamDaemon((v) => !v)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    enableDreamDaemon ? 'bg-primary' : 'bg-input',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition',
                      enableDreamDaemon ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
