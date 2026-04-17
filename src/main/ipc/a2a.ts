// A2A IPC adapter — thin bridge from ipcMain to the Dispatcher.
import { ipcMain } from 'electron';
import type { EventEmitter } from 'events';
import type { AgentCardRegistry } from '../services/a2a/AgentCardRegistry';
import type { TaskManager } from '../services/a2a/TaskManager';
import type { Dispatcher } from '../rpc/dispatcher';
import type { PushBus } from '../rpc/pushBus';
import { registerA2AHandlers, A2A_CHANNELS } from '../rpc/handlers/a2a';
import { makeIpcBridge } from './bridge';

export function setupA2AIPC(
  dispatcher: Dispatcher,
  pushBus: PushBus,
  ipcEmitter: EventEmitter,
  agentCardRegistry: AgentCardRegistry,
  taskManager: TaskManager,
): void {
  registerA2AHandlers(dispatcher, ipcEmitter, agentCardRegistry, taskManager, pushBus);
  for (const channel of A2A_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }
}
