// Generic IPC bridge: translates an Electron IpcMainInvokeEvent into an
// InvocationCtx and forwards to the Dispatcher. Every domain adapter under
// src/main/ipc/ uses this helper so there is one definition of "how IPC
// becomes a dispatcher call" in the codebase.
//
// For server-initiated pushes (caller-scope vs broadcast), see PushBus.
import { BrowserWindow } from 'electron';
import type { Dispatcher, InvocationCtx } from '../rpc/dispatcher';
import { getOutboundEntry, translateForIpc } from '../rpc/outboundRegistry';

export type IpcBridge = (
  event: Electron.IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<unknown>;

export type IpcSendBridge = (event: Electron.IpcMainEvent, ...args: unknown[]) => void;

function makeCtx(sender: Electron.WebContents): InvocationCtx {
  const win = BrowserWindow.fromWebContents(sender);
  return {
    reply: {
      emit(replyChannel, payload) {
        if (!getOutboundEntry(replyChannel)) {
          throw new Error(
            `[ipcBridge] emit for unregistered outbound channel: ${replyChannel}`,
          );
        }
        if (!win || win.isDestroyed()) return;
        const ipcArgs = translateForIpc(replyChannel, payload);
        win.webContents.send(replyChannel, ...ipcArgs);
      },
    },
    senderHandle: sender,
    transport: 'ipc',
  };
}

export function makeIpcBridge(dispatcher: Dispatcher, channel: string): IpcBridge {
  return async (event, ...args) => {
    const ctx = makeCtx(event.sender);
    return dispatcher.invoke(channel, args, ctx);
  };
}

/**
 * `ipcMain.on` variant — send-only channels (`window:*`). No response
 * channel, so handler errors are logged and dropped rather than thrown.
 */
export function makeIpcSendBridge(dispatcher: Dispatcher, channel: string): IpcSendBridge {
  return (event, ...args) => {
    const ctx = makeCtx(event.sender);
    dispatcher.invoke(channel, args, ctx).catch((err) => {
      console.error(`[ipcBridge] ${channel} (send) failed:`, err);
    });
  };
}
