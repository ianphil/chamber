import React from 'react';
import { cn } from '../../lib/utils';
import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';

// ---------------------------------------------------------------------------
// Mode metadata
// ---------------------------------------------------------------------------

interface ModeOption {
  value: OrchestrationMode;
  label: string;
  enabled: boolean;
  description: string;
  bestFor: string;
}

const MODES: ModeOption[] = [
  {
    value: 'concurrent',
    label: 'Concurrent',
    enabled: true,
    description: 'All agents respond to every message simultaneously, independently.',
    bestFor: 'Getting multiple perspectives at once, brainstorming, parallel research, comparing approaches across agents.',
  },
  {
    value: 'sequential',
    label: 'Sequential',
    enabled: true,
    description: 'Agents respond in turn, each seeing the previous agent\'s full response.',
    bestFor: 'Progressive refinement, pipelines where each agent builds on the last (e.g. research → draft → review).',
  },
  {
    value: 'group-chat',
    label: 'Group Chat',
    enabled: true,
    description: 'A designated moderator agent decides who speaks next and steers the discussion.',
    bestFor: 'Structured debate, role-play, panel discussions, when you need controlled turn-taking with a clear chair.',
  },
  {
    value: 'handoff',
    label: 'Handoff',
    enabled: true,
    description: 'One agent handles the task until it decides to pass control to a more suitable agent.',
    bestFor: 'Specialised pipelines across distinct domains (e.g. diagnose → fix → document a customer issue).',
  },
  {
    value: 'magentic',
    label: 'Magentic',
    enabled: true,
    description: 'A manager agent decomposes the goal into a task ledger and delegates subtasks to workers.',
    bestFor: 'Complex multi-step projects, long-running workflows, anything that benefits from explicit task planning and parallel delegation.',
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrchestrationPickerProps {
  mode: OrchestrationMode;
  groupChatConfig: GroupChatConfig | null;
  handoffConfig: HandoffConfig | null;
  magneticConfig: MagenticConfig | null;
  minds: MindContext[];
  disabled?: boolean;
  onModeChange: (mode: OrchestrationMode) => void;
  onGroupChatConfigChange: (config: GroupChatConfig) => void;
  onHandoffConfigChange: (config: HandoffConfig) => void;
  onMagneticConfigChange: (config: MagenticConfig) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrchestrationPicker({
  mode,
  groupChatConfig,
  handoffConfig,
  magneticConfig,
  minds,
  disabled = false,
  onModeChange,
  onGroupChatConfigChange,
  onHandoffConfigChange,
  onMagneticConfigChange,
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

    // Auto-create default handoff config
    if (newMode === 'handoff' && !handoffConfig) {
      onHandoffConfigChange({
        initialMindId: readyMinds[0]?.mindId,
        maxHandoffHops: 5,
      });
    }

    // Auto-create default magentic config
    if (newMode === 'magentic' && !magneticConfig && readyMinds.length > 0) {
      onMagneticConfigChange({
        managerMindId: readyMinds[0].mindId,
        maxSteps: 10,
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
            title={!opt.enabled ? `${opt.label} — coming soon` : `${opt.description}\n\nBest for: ${opt.bestFor}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Active mode description */}
      {(() => {
        const active = MODES.find((m) => m.value === mode);
        if (!active) return null;
        return (
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="font-medium text-foreground/70">{active.label}:</span>{' '}
            {active.description}{' '}
            <span className="text-muted-foreground/60">Best for: {active.bestFor}</span>
          </p>
        );
      })()}

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

      {/* Handoff config: initial agent selector */}
      {mode === 'handoff' && readyMinds.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Start with:</span>
          <select
            disabled={disabled}
            value={handoffConfig?.initialMindId ?? readyMinds[0].mindId}
            onChange={(e) => {
              onHandoffConfigChange({
                initialMindId: e.target.value,
                maxHandoffHops: handoffConfig?.maxHandoffHops ?? 5,
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

      {/* Magentic config: manager selector */}
      {mode === 'magentic' && readyMinds.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Manager:</span>
          <select
            disabled={disabled}
            value={magneticConfig?.managerMindId ?? readyMinds[0].mindId}
            onChange={(e) => {
              onMagneticConfigChange({
                managerMindId: e.target.value,
                maxSteps: magneticConfig?.maxSteps ?? 10,
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
