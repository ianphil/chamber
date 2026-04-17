import type { EventEmitter } from 'events';
import type { Dispatcher } from '../dispatcher';
import type { PushBus } from '../pushBus';
import type { AgentCardRegistry } from '../../services/a2a/AgentCardRegistry';
import type { TaskManager } from '../../services/a2a/TaskManager';
import type {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from '../../services/a2a/types';
import type {
  A2aIncomingPush,
  A2aTaskStatusUpdatePush,
  A2aTaskArtifactUpdatePush,
  ChatEventPush,
} from '../../../contracts/outbound';
import {
  A2aCancelTaskArgs,
  A2aGetTaskArgs,
  A2aListAgentsArgs,
  A2aListTasksArgs,
} from '../../../contracts/a2a';

export const A2A_CHANNELS = [
  'a2a:listAgents',
  'a2a:getTask',
  'a2a:listTasks',
  'a2a:cancelTask',
] as const;

/**
 * Register a2a handlers + bridge a2a event emissions through the PushBus.
 *
 * Phase 2 note: a2a handlers ARE on the dispatcher, but the WebSocket
 * transport still rejects them with -32601 because the A2A payload types
 * carry `Uint8Array` parts that aren't JSON-safe. A dedicated recursive
 * base64 codec lands separately; until then a2a is IPC-only.
 */
export function registerA2AHandlers(
  dispatcher: Dispatcher,
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
  pushBus: PushBus,
): void {
  dispatcher.register('a2a:listAgents', A2aListAgentsArgs, async () => agentCardRegistry.getCards());

  dispatcher.register('a2a:getTask', A2aGetTaskArgs, async ([taskId, historyLength]) => {
    return taskManager.getTask(taskId, historyLength);
  });

  dispatcher.register('a2a:listTasks', A2aListTasksArgs, async ([filter]) => {
    return taskManager.listTasks(filter);
  });

  dispatcher.register('a2a:cancelTask', A2aCancelTaskArgs, async ([taskId]) => {
    return taskManager.cancelTask(taskId);
  });

  // Broadcast push events.
  ipcEmitter.on('a2a:incoming', (payload: A2aIncomingPush) => {
    pushBus.publish('a2a:incoming', payload);
  });

  ipcEmitter.on('a2a:chat-event', (payload: ChatEventPush) => {
    // Router emits chat events that are fan-out, not caller-scoped.
    pushBus.publish('chat:event', payload);
  });

  ipcEmitter.on('task:status-update', (payload: TaskStatusUpdateEvent) => {
    pushBus.publish('a2a:task-status-update', payload as A2aTaskStatusUpdatePush);
  });

  ipcEmitter.on('task:artifact-update', (payload: TaskArtifactUpdateEvent) => {
    pushBus.publish('a2a:task-artifact-update', payload as A2aTaskArtifactUpdatePush);
  });
}
