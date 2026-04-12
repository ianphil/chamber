// Shared SDK path resolution — used by both sdkImport and CopilotClientFactory

import { app } from 'electron';
import { getGlobalNodeModules } from './SdkDiscovery';
import { getLocalNodeModulesDir, isLocalInstallReady } from './SdkBootstrap';

export function resolveNodeModulesDir(): string {
  if (app.isPackaged && isLocalInstallReady()) {
    return getLocalNodeModulesDir();
  }
  return getGlobalNodeModules();
}
