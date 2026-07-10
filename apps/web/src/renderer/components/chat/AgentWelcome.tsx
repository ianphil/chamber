import type { MindContext } from '@chamber/shared/types';
import { useAppState } from '../../lib/store';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { AgentAvatar } from '../profile/AgentAvatar';

const STARTER_PROMPTS = [
  { label: 'Daily briefing', prompt: 'Give me my daily report' },
  { label: 'What can you do?', prompt: 'What skills and capabilities do you have? How can you help me?' },
  { label: 'Explore the mind', prompt: 'What do you know about? List your domains and expertise areas.' },
];

interface Props {
  mind: MindContext;
  onPickPrompt: (prompt: string) => void;
  disabled?: boolean;
}

/**
 * AgentWelcome — chat empty state for an active agent. Mirrors the simple
 * centered layout from the product shot: the agent's avatar, its name, a
 * greeting, and a short strip of starter prompts. Deeper detail (lens views,
 * tools, skills) lives in the agent profile modal, not here.
 */
export function AgentWelcome({ mind, onPickPrompt, disabled = false }: Props) {
  const { minds } = useAppState();
  const profileByMindId = useMindProfiles(minds);
  const profile = profileByMindId[mind.mindId];
  const name = profile?.displayName ?? mind.identity.name;

  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <AgentAvatar
          name={name}
          avatarDataUrl={profile?.avatarDataUrl}
          className="glow-genesis w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center text-2xl font-bold text-primary-foreground"
          fallbackClassName="bg-gradient-to-br from-genesis to-[oklch(0.46_0.14_165)]"
          fallback={name.charAt(0).toUpperCase()}
        />

        <h2 className="text-2xl font-semibold mb-2 tracking-tight">{name}</h2>
        <p className="text-muted-foreground mb-6">How can I help you today?</p>

        <div className="grid grid-cols-3 gap-3 max-w-xl">
          {STARTER_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              onClick={() => onPickPrompt(item.prompt)}
              className="surface-card surface-card-hover text-left p-3 rounded-xl border border-border bg-card group disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm font-medium group-hover:text-foreground">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
