// Shared SDK path resolution — used by both sdkImport and CopilotClientFactory

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getRuntimeNodeModulesDir, isRuntimeReady } from './SdkBootstrap';

function getProjectNodeModulesDir(): string | null {
  const modulesDir = path.join(process.cwd(), 'node_modules');
  if (fs.existsSync(path.join(modulesDir, '@github', 'copilot-sdk', 'package.json'))) {
    return modulesDir;
  }
  return null;
}

export function resolveNodeModulesDir(): string {
  if (!app.isPackaged) {
    const projectModulesDir = getProjectNodeModulesDir();
    if (projectModulesDir) {
      return projectModulesDir;
    }

    throw new Error(
      'Chamber requires the repo-local @github/copilot-sdk install in dev mode. Run: npm install'
    );
  }

  if (app.isPackaged && isRuntimeReady()) {
    return getRuntimeNodeModulesDir();
  }

  throw new Error(
    'Chamber could not find its packaged Copilot runtime. Reinstall the app.'
  );
}
