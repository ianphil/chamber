// Lens IPC handlers — thin adapters for ViewDiscovery
import { BrowserWindow, ipcMain } from 'electron';
import type { MindManager, ViewDiscovery } from '@chamber/services';
import type { LensViewManifest } from '@chamber/shared/types';

export function setupLensIPC(viewDiscovery: ViewDiscovery, mindManager: MindManager): void {
  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id)?.mindPath : undefined;
  };

  ipcMain.handle('lens:getViews', async (_event, mindId?: string) => {
    return viewDiscovery.getViews(resolveMindPath(mindId));
  });

  ipcMain.handle('lens:getViewData', async (_event, viewId: string, mindId?: string) => {
    return viewDiscovery.getViewData(viewId, resolveMindPath(mindId));
  });

  ipcMain.handle('lens:refreshView', async (_event, viewId: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.refreshView(viewId, mindPath);
  });

  ipcMain.handle('lens:sendAction', async (_event, viewId: string, action: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.sendAction(viewId, action, mindPath);
  });

  mindManager.on('lens:viewsChanged', (views: LensViewManifest[]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('lens:viewsChanged', views);
    }
  });
}
