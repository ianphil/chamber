// Cron extension adapter — loads cron tools from a mind's .github/extensions/cron/
// Imports the three tool factory modules and initializes them with extDir and state.

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import type { LoadedExtension } from '../ExtensionLoader';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

interface CronToolFactory {
  [key: string]: (extDir: string, state: { agentName: string }) => Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }>;
}

export async function loadCronExtension(extDir: string): Promise<LoadedExtension> {
  const toolFiles = ['crud.mjs', 'lifecycle.mjs', 'engine-control.mjs'];
  for (const f of toolFiles) {
    if (!fs.existsSync(path.join(extDir, 'tools', f))) {
      throw new Error(`Cron extension missing tools/${f} in ${extDir}`);
    }
  }

  // Derive agent name from the mind directory name
  const mindRoot = path.resolve(extDir, '..', '..', '..');
  const agentName = path.basename(mindRoot).replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  const state = { agentName };

  const allTools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }> = [];

  for (const f of toolFiles) {
    const modulePath = path.join(extDir, 'tools', f);
    const mod = await dynamicImport(pathToFileURL(modulePath).href) as CronToolFactory;
    // Each module exports a create*Tools function — find it
    const factoryName = Object.keys(mod).find((k) => k.startsWith('create') && k.endsWith('Tools'));
    if (!factoryName) {
      console.warn(`[Cron] No factory function found in ${f}, skipping`);
      continue;
    }
    const tools = mod[factoryName](extDir, state);
    allTools.push(...tools);
  }

  console.log(`[Cron] Loaded ${allTools.length} tools (agent: ${agentName})`);

  return {
    name: 'cron',
    tools: allTools,
    cleanup: async () => {
      console.log('[Cron] Cleaned up');
    },
  };
}
