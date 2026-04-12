// Lens IPC handlers — thin adapters for ViewDiscovery
import { ipcMain } from 'electron';
import type { ViewDiscovery } from '../services/lens';
import type { MindManager } from '../services/mind/MindManager';

export function setupLensIPC(viewDiscovery: ViewDiscovery, mindManager: MindManager): void {
  ipcMain.handle('lens:getViews', async (_event, mindId?: string) => {
    const mindPath = mindId ? mindManager.getMind(mindId)?.mindPath : undefined;
    return viewDiscovery.getViews(mindPath);
  });

  ipcMain.handle('lens:getViewData', async (_event, viewId: string, mindId?: string) => {
    const mindPath = mindId ? mindManager.getMind(mindId)?.mindPath : undefined;
    return viewDiscovery.getViewData(viewId, mindPath);
  });

  ipcMain.handle('lens:refreshView', async (_event, viewId: string, mindId?: string) => {
    const mindPath = mindId ? mindManager.getMind(mindId)?.mindPath : undefined;
    if (!mindPath) return viewDiscovery.getViewData(viewId);
    return viewDiscovery.refreshView(viewId, mindPath);
  });

  ipcMain.handle('lens:sendAction', async (_event, viewId: string, action: string, mindId?: string) => {
    const mindPath = mindId ? mindManager.getMind(mindId)?.mindPath : undefined;
    if (!mindPath) return viewDiscovery.getViewData(viewId);
    return viewDiscovery.sendAction(viewId, action, mindPath);
  });
}
