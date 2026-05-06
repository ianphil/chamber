// Lens IPC handlers — thin adapters for ViewDiscovery
import { BrowserWindow, ipcMain } from 'electron';
import type { CanvasService, MindManager, ViewDiscovery } from '@chamber/services';
import type { LensViewManifest } from '@chamber/shared/types';

export function setupLensIPC(viewDiscovery: ViewDiscovery, mindManager: MindManager, canvasService: CanvasService): void {
  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id)?.mindPath : undefined;
  };

  const resolveMind = (mindId?: string) => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id) : undefined;
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

  ipcMain.handle('lens:getCanvasUrl', async (_event, viewId: string, mindId?: string) => {
    const mind = resolveMind(mindId);
    if (!mind) return null;
    const sourcePath = viewDiscovery.getViewSourcePath(viewId, mind.mindPath);
    if (!sourcePath) return null;
    return canvasService.showLensCanvas(mind.mindId, mind.mindPath, viewId, sourcePath);
  });

  mindManager.on('lens:viewsChanged', (views: LensViewManifest[], mindId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('lens:viewsChanged', views, mindId);
    }
  });
}
