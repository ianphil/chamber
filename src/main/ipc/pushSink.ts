// IPC push sink — subscribes the PushBus and fans out every broadcast to
// every (non-destroyed) BrowserWindow via `webContents.send` in the
// positional wire format the renderer already consumes.
//
// This is the IPC counterpart of the per-socket fan-out in wsServer.ts.
// Both subscribe the same PushBus, so handlers only need to call
// `pushBus.publish(channel, payload)` once to reach every transport.
import { BrowserWindow } from 'electron';
import type { PushBus } from '../rpc/pushBus';
import { translateForIpc } from '../rpc/outboundRegistry';

export function installIpcPushSink(pushBus: PushBus): () => void {
  return pushBus.subscribe((channel, payload) => {
    const args = translateForIpc(channel, payload);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(channel, ...args);
      } catch (err) {
        console.error(`[ipcPushSink] send failed on ${channel}:`, err);
      }
    }
  });
}
