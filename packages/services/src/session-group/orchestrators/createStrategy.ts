import type { OrchestrationMode, GroupChatConfig, HandoffConfig, MagenticConfig } from '@chamber/shared/chatroom-types';
import type { OrchestrationStrategy } from './legacy-types';
import { ConcurrentStrategy } from './ConcurrentStrategy';
import { SequentialStrategy } from './SequentialStrategy';
import { GroupChatStrategy } from './GroupChatStrategy';
import { HandoffStrategy } from './HandoffStrategy';
import { MagenticStrategy } from './MagenticStrategy';

// ---------------------------------------------------------------------------
// createStrategy — factory used by ChatroomService.broadcast
// ---------------------------------------------------------------------------

/**
 * Build the strategy for an orchestration mode. The caller wraps the result
 * via `wrapStrategy()` to satisfy the `SessionGroupOrchestrator` contract
 * expected by `SessionGroup.run()`.
 */
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
