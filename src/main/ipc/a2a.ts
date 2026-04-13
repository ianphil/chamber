import { ipcMain, BrowserWindow } from 'electron';
import type { EventEmitter } from 'events';
import type { AgentCardRegistry } from '../services/a2a/AgentCardRegistry';

export function setupA2AIPC(ipcEmitter: EventEmitter, agentCardRegistry: AgentCardRegistry): void {
  // Forward a2a:incoming events to all renderer windows
  ipcEmitter.on('a2a:incoming', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('a2a:incoming', payload);
    }
  });

  // Forward A2A chat events (streaming from target agent) to all renderer windows
  ipcEmitter.on('a2a:chat-event', (payload: { mindId: string; messageId: string; event: unknown }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('chat:event', payload.mindId, payload.messageId, payload.event);
    }
  });

  ipcMain.handle('a2a:listAgents', async () => {
    return agentCardRegistry.getCards();
  });
}
