// Lens IPC handlers — thin adapters for ViewDiscovery
import { ipcMain } from 'electron';
import type { ViewDiscovery } from '../services/lens';
import type { MindManager } from '../services/mind';
import { withValidation } from './withValidation';
import {
  LensGetViewDataArgs,
  LensGetViewsArgs,
  LensRefreshViewArgs,
  LensSendActionArgs,
} from '../../contracts/lens';

export function setupLensIPC(viewDiscovery: ViewDiscovery, mindManager: MindManager): void {
  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id)?.mindPath : undefined;
  };

  ipcMain.handle(
    'lens:getViews',
    withValidation('lens:getViews', LensGetViewsArgs, async (_event, mindId) => {
      return viewDiscovery.getViews(resolveMindPath(mindId));
    }),
  );

  ipcMain.handle(
    'lens:getViewData',
    withValidation('lens:getViewData', LensGetViewDataArgs, async (_event, viewId, mindId) => {
      return viewDiscovery.getViewData(viewId, resolveMindPath(mindId));
    }),
  );

  ipcMain.handle(
    'lens:refreshView',
    withValidation('lens:refreshView', LensRefreshViewArgs, async (_event, viewId, mindId) => {
      const mindPath = resolveMindPath(mindId);
      if (!mindPath) return null;
      return viewDiscovery.refreshView(viewId, mindPath);
    }),
  );

  ipcMain.handle(
    'lens:sendAction',
    withValidation('lens:sendAction', LensSendActionArgs, async (_event, viewId, action, mindId) => {
      const mindPath = resolveMindPath(mindId);
      if (!mindPath) return null;
      return viewDiscovery.sendAction(viewId, action, mindPath);
    }),
  );
}
