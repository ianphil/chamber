import type { EventEmitter } from 'events';
import type { AgentCardRegistry, MindManager, TaskArtifactUpdateEvent, TaskManager, TaskStatusUpdateEvent } from '@chamber/services';

import type { MindContext } from '@chamber/shared/types';

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
  taskManager.on('task:status-update', (event: TaskStatusUpdateEvent) => a2aEventBus.emit('task:status-update', event));
  taskManager.on('task:artifact-update', (event: TaskArtifactUpdateEvent) => a2aEventBus.emit('task:artifact-update', event));
}
