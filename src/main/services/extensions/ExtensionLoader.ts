// ExtensionLoader — discovers mind extensions and loads their tools into SDK sessions.
// Each supported extension has an adapter that knows how to initialize it.

import * as fs from 'fs';
import * as path from 'path';

export interface ExtensionTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface LoadedExtension {
  name: string;
  tools: ExtensionTool[];
  cleanup: () => Promise<void>;
}

export type ExtensionAdapter = (extDir: string) => Promise<LoadedExtension>;

export class ExtensionLoader {
  private adapters = new Map<string, ExtensionAdapter>();
  private loaded = new Map<string, LoadedExtension>();

  registerAdapter(name: string, adapter: ExtensionAdapter): void {
    this.adapters.set(name, adapter);
  }

  discoverExtensions(mindPath: string): string[] {
    const extRoot = path.join(mindPath, '.github', 'extensions');
    if (!fs.existsSync(extRoot)) return [];

    try {
      return fs.readdirSync(extRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  async loadTools(mindPath: string): Promise<ExtensionTool[]> {
    // Clean up previously loaded extensions
    await this.cleanup();

    const discovered = this.discoverExtensions(mindPath);
    const allTools: ExtensionTool[] = [];

    for (const extName of discovered) {
      const adapter = this.adapters.get(extName);
      if (!adapter) {
        console.log(`[ExtensionLoader] No adapter for '${extName}', skipping`);
        continue;
      }

      const extDir = path.join(mindPath, '.github', 'extensions', extName);
      try {
        console.log(`[ExtensionLoader] Loading '${extName}' from ${extDir}`);
        const loaded = await adapter(extDir);
        this.loaded.set(extName, loaded);
        allTools.push(...loaded.tools);
        console.log(`[ExtensionLoader] Loaded '${extName}': ${loaded.tools.length} tool(s)`);
      } catch (err) {
        console.error(`[ExtensionLoader] Failed to load '${extName}':`, err);
      }
    }

    return allTools;
  }

  getLoadedExtensions(): string[] {
    return Array.from(this.loaded.keys());
  }

  async cleanup(): Promise<void> {
    for (const [name, ext] of this.loaded) {
      try {
        await ext.cleanup();
        console.log(`[ExtensionLoader] Cleaned up '${name}'`);
      } catch (err) {
        console.error(`[ExtensionLoader] Cleanup error for '${name}':`, err);
      }
    }
    this.loaded.clear();
  }
}
