// ExtensionLoader — discovers mind extensions and loads their tools into SDK sessions.
// Stateless: returns loaded extensions, caller stores them per-mind.

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

export interface LoadResult {
  tools: ExtensionTool[];
  loaded: LoadedExtension[];
}

export class ExtensionLoader {
  private adapters = new Map<string, ExtensionAdapter>();

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

  async loadTools(mindPath: string): Promise<LoadResult> {
    const discovered = this.discoverExtensions(mindPath);
    const allTools: ExtensionTool[] = [];
    const loaded: LoadedExtension[] = [];

    for (const extName of discovered) {
      const adapter = this.adapters.get(extName);
      if (!adapter) continue;

      const extDir = path.join(mindPath, '.github', 'extensions', extName);
      try {
        const ext = await adapter(extDir);
        loaded.push(ext);
        allTools.push(...ext.tools);
      } catch (err) {
        console.error(`[ExtensionLoader] Failed to load '${extName}':`, err);
      }
    }

    return { tools: allTools, loaded };
  }

  static async cleanup(loaded: LoadedExtension[]): Promise<void> {
    for (const ext of loaded) {
      try {
        await ext.cleanup();
      } catch (err) {
        console.error(`[ExtensionLoader] Cleanup error for '${ext.name}':`, err);
      }
    }
  }
}
