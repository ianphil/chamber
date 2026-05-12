import type { EventEmitter } from 'events';
import { Logger, type A2ARelayModeService, type AgentCardRegistry, type MindManager, type TaskArtifactUpdateEvent, type TaskManager, type TaskStatusUpdateEvent } from '@chamber/services';

import type { MindContext } from '@chamber/shared/types';

const log = Logger.create('wireLifecycleEvents');

interface LifecycleServices {
  mindManager: MindManager;
  agentCardRegistry: AgentCardRegistry;
  a2aRelayModeService?: A2ARelayModeService;
  taskManager: TaskManager;
  a2aEventBus: EventEmitter;
}

/** Wire cross-service lifecycle events that don't belong in any single service. */
export function wireLifecycleEvents({ mindManager, agentCardRegistry, a2aRelayModeService, taskManager, a2aEventBus }: LifecycleServices): void {
  // AgentCardRegistry tracks MindManager lifecycle
  mindManager.on('mind:loaded', (ctx: MindContext) => {
    agentCardRegistry.register(ctx);
    a2aRelayModeService?.publishLocalCard(ctx.mindId).catch((error: unknown) => {
      log.warn(`Failed to publish A2A card for ${ctx.mindId}:`, error);
    });
  });
  mindManager.on('mind:unloaded', (mindId: string) => {
    a2aRelayModeService?.unpublishLocalCard(mindId).catch((error: unknown) => {
      log.warn(`Failed to unpublish A2A card for ${mindId}:`, error);
    });
    agentCardRegistry.unregister(mindId);
  });

  // TaskManager events forwarded to IPC bus
  taskManager.on('task:status-update', (event: TaskStatusUpdateEvent) => a2aEventBus.emit('task:status-update', event));
  taskManager.on('task:artifact-update', (event: TaskArtifactUpdateEvent) => a2aEventBus.emit('task:artifact-update', event));
}
