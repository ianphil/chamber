import type { OrchestrationMode, GroupChatConfig } from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy } from './types';
import { ConcurrentStrategy } from './ConcurrentStrategy';
import { SequentialStrategy } from './SequentialStrategy';
import { GroupChatStrategy } from './GroupChatStrategy';

export type { OrchestrationStrategy, OrchestrationContext } from './types';
export { ConcurrentStrategy } from './ConcurrentStrategy';
export { SequentialStrategy } from './SequentialStrategy';
export { GroupChatStrategy } from './GroupChatStrategy';

export function createStrategy(
  mode: OrchestrationMode,
  groupChatConfig?: GroupChatConfig,
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
    case 'handoff':
    case 'magentic':
      throw new Error(`Orchestration mode "${mode}" is not yet implemented`);
    default:
      return new ConcurrentStrategy();
  }
}
