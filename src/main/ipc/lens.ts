// Lens IPC adapter — thin bridge from ipcMain to the Dispatcher.
import { ipcMain } from 'electron';
import type { ViewDiscovery } from '../services/lens';
import type { MindManager } from '../services/mind';
import type { Dispatcher } from '../rpc/dispatcher';
import { registerLensHandlers, LENS_CHANNELS } from '../rpc/handlers/lens';
import { makeIpcBridge } from './bridge';

export function setupLensIPC(
  dispatcher: Dispatcher,
  viewDiscovery: ViewDiscovery,
  mindManager: MindManager,
): void {
  registerLensHandlers(dispatcher, viewDiscovery, mindManager);
  for (const channel of LENS_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }
}
