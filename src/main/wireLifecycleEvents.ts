import type { EventEmitter } from 'events';
import type { MindManager } from './services/mind/MindManager';
import type { AgentCardRegistry, TaskManager } from './services/a2a';

import type { MindContext } from '../shared/types';

interface LifecycleServices {
  mindManager: MindManager;
  agentCardRegistry: AgentCardRegistry;
  taskManager: TaskManager;
  a2aEventBus: EventEmitter;
}

/** Wire cross-service lifecycle events that don't belong in any single service. */
export function wireLifecycleEvents({ mindManager, agentCardRegistry, taskManager, a2aEventBus }: LifecycleServices): void {
  // AgentCardRegistry tracks MindManager lifecycle
  mindManager.on('mind:loaded', (ctx: MindContext) => agentCardRegistry.register(ctx));
  mindManager.on('mind:unloaded', (mindId: string) => agentCardRegistry.unregister(mindId));

  // TaskManager events forwarded to IPC bus
  taskManager.on('task:status-update', (event) => a2aEventBus.emit('task:status-update', event));
  taskManager.on('task:artifact-update', (event) => a2aEventBus.emit('task:artifact-update', event));
}
