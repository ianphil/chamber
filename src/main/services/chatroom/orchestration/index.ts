import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy } from './types';
import { ConcurrentStrategy } from './ConcurrentStrategy';
import { SequentialStrategy } from './SequentialStrategy';
import { GroupChatStrategy } from './GroupChatStrategy';
import { HandoffStrategy } from './HandoffStrategy';
import { MagenticStrategy } from './MagenticStrategy';

export type { OrchestrationStrategy, OrchestrationContext } from './types';
export { BaseStrategy } from './types';
export { ConcurrentStrategy } from './ConcurrentStrategy';
export { SequentialStrategy } from './SequentialStrategy';
export { GroupChatStrategy } from './GroupChatStrategy';
export { HandoffStrategy } from './HandoffStrategy';
export { MagenticStrategy } from './MagenticStrategy';
export { ObservabilityEmitter, redactParameters } from './observability';
export { ApprovalGate } from './approval-gate';
export type { ApprovalGateConfig, ApprovalHandler, ApprovalLogEntry } from './approval-gate';

export function createStrategy(
  mode: OrchestrationMode,
  groupChatConfig?: GroupChatConfig,
  handoffConfig?: HandoffConfig,
  magneticConfig?: MagenticConfig,
): OrchestrationStrategy {
  switch (mode) {
    case 'concurrent':
      return new ConcurrentStrategy();
    case 'sequential':
      return new SequentialStrategy();
    case 'group-chat': {
      if (!groupChatConfig) {
        throw new Error('GroupChatConfig is required for group-chat orchestration');
      }
      return new GroupChatStrategy(groupChatConfig);
    }
    case 'handoff': {
      return new HandoffStrategy(handoffConfig ?? { maxHandoffHops: 5 });
    }
    case 'magentic': {
      if (!magneticConfig) {
        throw new Error('MagenticConfig is required for magentic orchestration');
      }
      return new MagenticStrategy(magneticConfig);
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown orchestration mode: ${_exhaustive}`);
    }
  }
}
