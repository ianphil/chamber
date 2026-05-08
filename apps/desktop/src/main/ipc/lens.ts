// Lens IPC handlers — thin adapters for ViewDiscovery
import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
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

  ipcMain.handle(IPC.LENS.GET_VIEWS, async (_event, mindId?: string) => {
    return viewDiscovery.getViews(resolveMindPath(mindId));
  });

  ipcMain.handle(IPC.LENS.GET_VIEW_DATA, async (_event, viewId: string, mindId?: string) => {
    return viewDiscovery.getViewData(viewId, resolveMindPath(mindId));
  });

  ipcMain.handle(IPC.LENS.REFRESH_VIEW, async (_event, viewId: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.refreshView(viewId, mindPath);
  });

  ipcMain.handle(IPC.LENS.SEND_ACTION, async (_event, viewId: string, action: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.sendAction(viewId, action, mindPath);
  });

  ipcMain.handle(IPC.LENS.GET_CANVAS_URL, async (_event, viewId: string, mindId?: string) => {
    const mind = resolveMind(mindId);
    if (!mind) return null;
    const sourcePath = viewDiscovery.getViewSourcePath(viewId, mind.mindPath);
    if (!sourcePath) return null;
    return canvasService.showLensCanvas(mind.mindId, mind.mindPath, viewId, sourcePath);
  });

  // MindManager EventEmitter channel name (intentionally string, not IPC.*)
  // because this is an internal pub/sub channel within the main process.
  mindManager.on('lens:viewsChanged', (views: LensViewManifest[], mindId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.LENS.VIEWS_CHANGED, views, mindId);
    }
  });
}
