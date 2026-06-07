import { cn } from '../../lib/utils';
import type { MindContext } from '@chamber/shared/types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { AgentAvatar } from '../profile/AgentAvatar';
import { agentColor } from '../chat/agentColors';
import { profileDisplayName } from './chatroomModerator';

// ---------------------------------------------------------------------------
// ParticipantBar
// ---------------------------------------------------------------------------

export function ParticipantBar({ minds, streamingByMind, disabledMindIds, profileByMindId, onToggle }: {
  minds: MindContext[];
  streamingByMind: Record<string, boolean>;
  disabledMindIds: string[];
  profileByMindId: Record<string, AgentProfileSummary>;
  onToggle: (mindId: string, enabled: boolean) => void;
}) {
  if (minds.length === 0) return null;
  const disabledSet = new Set(disabledMindIds);
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border overflow-x-auto shrink-0">
      {minds.map((mind) => {
        const streaming = streamingByMind[mind.mindId];
        const disabled = disabledSet.has(mind.mindId);
        const profile = profileByMindId[mind.mindId];
        const name = profileDisplayName(profile, mind.identity.name);
        const color = agentColor(minds, mind.mindId, profileByMindId);
        const title = disabled
          ? streaming
            ? `${name} is disabled — currently responding to this round. Click to re-enable.`
            : `${name} is disabled. Click to enable.`
          : `${name} is enabled. Click to disable.`;
        return (
          <button
            type="button"
            key={mind.mindId}
            aria-pressed={!disabled}
            title={title}
            onClick={() => onToggle(mind.mindId, disabled)}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 whitespace-nowrap',
              'transition-opacity cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring',
              disabled
                ? 'opacity-50 line-through hover:opacity-75'
                : 'hover:opacity-90',
            )}
            style={{ backgroundColor: `${color}20`, color }}
          >
            <AgentAvatar
              name={name}
              avatarDataUrl={profile?.avatarDataUrl}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              fallbackClassName="text-white"
              fallback={name.charAt(0).toUpperCase()}
              style={{ backgroundColor: color, color: '#fff' }}
            />
            <span className={cn('w-2 h-2 rounded-full', streaming ? 'bg-warning chamber-caret' : 'bg-genesis')} />
            {name}
          </button>
        );
      })}
    </div>
  );
}
