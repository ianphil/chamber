import type { Dispatcher } from '../dispatcher';
import type { ViewDiscovery } from '../../services/lens';
import type { MindManager } from '../../services/mind';
import {
  LensGetViewDataArgs,
  LensGetViewsArgs,
  LensRefreshViewArgs,
  LensSendActionArgs,
} from '../../../contracts/lens';

export const LENS_CHANNELS = [
  'lens:getViews',
  'lens:getViewData',
  'lens:refreshView',
  'lens:sendAction',
] as const;

export function registerLensHandlers(
  dispatcher: Dispatcher,
  viewDiscovery: ViewDiscovery,
  mindManager: MindManager,
): void {
  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id)?.mindPath : undefined;
  };

  dispatcher.register('lens:getViews', LensGetViewsArgs, async ([mindId]) => {
    return viewDiscovery.getViews(resolveMindPath(mindId));
  });

  dispatcher.register('lens:getViewData', LensGetViewDataArgs, async ([viewId, mindId]) => {
    return viewDiscovery.getViewData(viewId, resolveMindPath(mindId));
  });

  dispatcher.register('lens:refreshView', LensRefreshViewArgs, async ([viewId, mindId]) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.refreshView(viewId, mindPath);
  });

  dispatcher.register('lens:sendAction', LensSendActionArgs, async ([viewId, action, mindId]) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.sendAction(viewId, action, mindPath);
  });
}
