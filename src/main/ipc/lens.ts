// Lens IPC handlers — wire ViewDiscovery to renderer
import { ipcMain } from 'electron';
import type { ViewDiscovery } from '../services/lens';

export function setupLensIPC(viewDiscovery: ViewDiscovery): void {
  ipcMain.handle('lens:getViews', async () => {
    return viewDiscovery.getViews();
  });

  ipcMain.handle('lens:getViewData', async (_event, viewId: string) => {
    return viewDiscovery.getViewData(viewId);
  });

  ipcMain.handle('lens:refreshView', async (_event, viewId: string) => {
    return viewDiscovery.refreshView(viewId);
  });

  ipcMain.handle('lens:sendAction', async (_event, viewId: string, action: string) => {
    return viewDiscovery.sendAction(viewId, action);
  });
}
