import React from 'react';
import { cn } from '../../lib/utils';
import type { OrchestrationMode, GroupChatConfig } from '../../../shared/chatroom-types';
import type { MindContext } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Mode metadata
// ---------------------------------------------------------------------------

interface ModeOption {
  value: OrchestrationMode;
  label: string;
  enabled: boolean;
}

const MODES: ModeOption[] = [
  { value: 'concurrent', label: 'Concurrent', enabled: true },
  { value: 'sequential', label: 'Sequential', enabled: true },
  { value: 'group-chat', label: 'Group Chat', enabled: true },
  { value: 'handoff', label: 'Handoff', enabled: false },
  { value: 'magentic', label: 'Magentic', enabled: false },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationPickerProps {
  mode: OrchestrationMode;
  groupChatConfig: GroupChatConfig | null;
  minds: MindContext[];
  disabled?: boolean;
  onModeChange: (mode: OrchestrationMode) => void;
  onGroupChatConfigChange: (config: GroupChatConfig) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrationPicker({
  mode,
  groupChatConfig,
  minds,
  disabled = false,
  onModeChange,
  onGroupChatConfigChange,
}: OrchestrationPickerProps) {
  const readyMinds = minds.filter((m) => m.status === 'ready');

  const handleModeChange = (newMode: OrchestrationMode) => {
    if (disabled) return;
    onModeChange(newMode);

    // Auto-create default group chat config when switching to group-chat
    if (newMode === 'group-chat' && !groupChatConfig && readyMinds.length > 0) {
      onGroupChatConfigChange({
        moderatorMindId: readyMinds[0].mindId,
        maxTurns: 10,
        minRounds: 1,
        maxSpeakerRepeats: 3,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-2 border-b border-border" data-testid="orchestration-picker">
      {/* Mode selector */}
      <div className="flex items-center gap-1">
        {MODES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled || !opt.enabled}
            onClick={() => handleModeChange(opt.value)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-full font-medium transition-colors',
              opt.value === mode
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
              (!opt.enabled || disabled) && 'opacity-50 cursor-not-allowed',
            )}
            aria-pressed={opt.value === mode}
            title={!opt.enabled ? `${opt.label} — coming soon` : opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Group Chat config: moderator selector */}
      {mode === 'group-chat' && readyMinds.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Moderator:</span>
          <select
            disabled={disabled}
            value={groupChatConfig?.moderatorMindId ?? readyMinds[0].mindId}
            onChange={(e) => {
              onGroupChatConfigChange({
                moderatorMindId: e.target.value,
                maxTurns: groupChatConfig?.maxTurns ?? 10,
                minRounds: groupChatConfig?.minRounds ?? 1,
                maxSpeakerRepeats: groupChatConfig?.maxSpeakerRepeats ?? 3,
              });
            }}
            className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs border border-border"
          >
            {readyMinds.map((mind) => (
              <option key={mind.mindId} value={mind.mindId}>
                {mind.identity.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
