// Canvas extension adapter — loads canvas tools from a mind's .github/extensions/canvas/
// Dynamically imports the ESM tool factory and server, runs them in the Electron main process.

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import type { LoadedExtension } from '../ExtensionLoader';

// Dynamic import helper — hides import() from Vite/webpack static analysis
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

interface CanvasServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  reload(): void;
  closeClients(): void;
  getPort(): number | null;
  isRunning(): boolean;
}

interface CanvasToolsModule {
  createCanvasTools: (
    contentDir: string,
    server: CanvasServer,
    onAction: (action: unknown) => void,
  ) => Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }>;
}

interface CanvasServerModule {
  createCanvasServer: (contentDir: string, onAction: (action: unknown) => void) => CanvasServer;
}

export async function loadCanvasExtension(extDir: string): Promise<LoadedExtension> {
  const toolsPath = path.join(extDir, 'tools', 'canvas-tools.mjs');
  const serverPath = path.join(extDir, 'lib', 'server.mjs');

  if (!fs.existsSync(toolsPath) || !fs.existsSync(serverPath)) {
    throw new Error(`Canvas extension missing required files in ${extDir}`);
  }

  const contentDir = path.join(extDir, 'data', 'content');
  fs.mkdirSync(contentDir, { recursive: true });

  const actionQueue: unknown[] = [];
  const onAction = (action: unknown) => {
    actionQueue.push(action);
    console.log('[Canvas] Action received:', JSON.stringify(action));
  };

  // Dynamic ESM import from the mind directory
  const serverModule = await dynamicImport(pathToFileURL(serverPath).href) as CanvasServerModule;
  const server = serverModule.createCanvasServer(contentDir, onAction);

  const toolsModule = await dynamicImport(pathToFileURL(toolsPath).href) as CanvasToolsModule;
  const tools = toolsModule.createCanvasTools(contentDir, server, onAction);

  console.log(`[Canvas] Loaded ${tools.length} tools, content dir: ${contentDir}`);

  return {
    name: 'canvas',
    tools,
    cleanup: async () => {
      if (server.isRunning()) {
        server.closeClients();
        await server.stop();
        console.log('[Canvas] Server stopped');
      }
    },
  };
}
