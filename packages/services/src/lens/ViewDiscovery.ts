// Lens view discovery — scans minds for view.json manifests, reads view data, handles prompt refresh.
// Per-mind storage: views and watchers keyed by mindPath.

import * as fs from 'fs';
import * as path from 'path';
import type { LensViewManifest } from '@chamber/shared/types';

export interface ViewRefreshHandler {
  sendBackgroundPrompt(mindPath: string, prompt: string): Promise<void>;
}

export class ViewDiscovery {
  private viewsByMind = new Map<string, LensViewManifest[]>();
  private watchersByMind = new Map<string, fs.FSWatcher[]>();
  private scanTimersByMind = new Map<string, ReturnType<typeof setTimeout>>();
  private refreshHandler: ViewRefreshHandler | null = null;

  constructor(refreshHandler?: ViewRefreshHandler) {
    this.refreshHandler = refreshHandler ?? null;
  }

  setRefreshHandler(handler: ViewRefreshHandler): void {
    this.refreshHandler = handler;
  }

  async scan(mindPath: string): Promise<LensViewManifest[]> {
    const views: LensViewManifest[] = [];
    const lensDir = path.join(mindPath, '.github', 'lens');

    if (fs.existsSync(lensDir)) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(lensDir, { withFileTypes: true });
      } catch (err) {
        console.warn(`[ViewDiscovery] Failed to read ${lensDir}:`, err);
        this.viewsByMind.set(mindPath, views);
        return views;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const viewJsonPath = path.join(lensDir, entry.name, 'view.json');
        if (!fs.existsSync(viewJsonPath)) continue;

        try {
          const raw = fs.readFileSync(viewJsonPath, 'utf-8');
          const manifest = JSON.parse(raw) as LensViewManifest;
          manifest.id = entry.name;
          manifest._basePath = path.join(lensDir, entry.name);
          views.push(manifest);
        } catch (err) {
          console.error(`[ViewDiscovery] Failed to parse ${viewJsonPath}:`, err);
        }
      }
    }

    this.viewsByMind.set(mindPath, views);
    return views;
  }

  getViews(mindPath?: string): LensViewManifest[] {
    if (mindPath) return this.viewsByMind.get(mindPath) ?? [];
    // Return all views across all minds
    const all: LensViewManifest[] = [];
    for (const views of this.viewsByMind.values()) all.push(...views);
    return all;
  }

  getViewData(viewId: string, mindPath?: string): Record<string, unknown> | null {
    const views = mindPath ? this.getViews(mindPath) : this.getViews();
    const view = views.find(v => v.id === viewId);
    if (!view || !view._basePath) return null;

    const dataPath = path.join(view._basePath, view.source);
    if (!fs.existsSync(dataPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  async refreshView(viewId: string, mindPath: string): Promise<Record<string, unknown> | null> {
    const views = this.getViews(mindPath);
    const view = views.find(v => v.id === viewId);
    if (!view || !view.prompt || !view._basePath) return this.getViewData(viewId, mindPath);

    const dataPath = path.join(view._basePath, view.source);
    const fullPrompt = `${view.prompt}\n\nWrite the JSON output to: ${dataPath}`;

    try {
      await this.refreshHandler?.sendBackgroundPrompt(mindPath, fullPrompt);
      return this.getViewData(viewId, mindPath);
    } catch {
      return this.getViewData(viewId, mindPath);
    }
  }

  async sendAction(viewId: string, action: string, mindPath: string): Promise<Record<string, unknown> | null> {
    const views = this.getViews(mindPath);
    const view = views.find(v => v.id === viewId);
    if (!view || !view._basePath) return this.getViewData(viewId, mindPath);

    const dataPath = path.join(view._basePath, view.source);
    const fullPrompt = `The user is viewing "${view.name}" (source: ${dataPath}).\n\nAction requested: ${action}\n\nMake the requested change and write the updated JSON to: ${dataPath}`;

    try {
      await this.refreshHandler?.sendBackgroundPrompt(mindPath, fullPrompt);
      return this.getViewData(viewId, mindPath);
    } catch {
      return this.getViewData(viewId, mindPath);
    }
  }

  startWatching(mindPath: string, onChanged: () => void): void {
    this.stopWatching(mindPath);
    const lensDir = path.join(mindPath, '.github', 'lens');

    if (fs.existsSync(lensDir)) {
      this.watchLensDir(mindPath, lensDir, onChanged);
    } else {
      // lens/ doesn't exist yet — watch .github/ for its creation
      const githubDir = path.join(mindPath, '.github');
      if (!fs.existsSync(githubDir)) return;

      const watchers: fs.FSWatcher[] = [];
      try {
        const parentWatcher = fs.watch(githubDir, (_eventType, filename) => {
          if (filename === 'lens' && fs.existsSync(lensDir)) {
            parentWatcher.close();
            this.watchLensDir(mindPath, lensDir, onChanged);
            this.scheduleScan(mindPath, onChanged);
          }
        });
        watchers.push(parentWatcher);
      } catch { /* watch not supported */ }
      this.watchersByMind.set(mindPath, watchers);
    }
  }

  private watchLensDir(mindPath: string, lensDir: string, onChanged: () => void): void {
    const watchers: fs.FSWatcher[] = [];
    try {
      const watcher = fs.watch(lensDir, { recursive: true }, (_eventType, filename) => {
        if (filename) this.scheduleScan(mindPath, onChanged);
      });
      watchers.push(watcher);
    } catch { /* watch not supported */ }
    this.watchersByMind.set(mindPath, watchers);
  }

  private scheduleScan(mindPath: string, onChanged: () => void): void {
    const existingTimer = this.scanTimersByMind.get(mindPath);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.scanTimersByMind.delete(mindPath);
      void this.scan(mindPath).then(onChanged).catch((err: unknown) => {
        console.warn(`[ViewDiscovery] Failed to rescan lens views for ${mindPath}:`, err);
      });
    }, 300);
    this.scanTimersByMind.set(mindPath, timer);
  }

  stopWatching(mindPath?: string): void {
    if (mindPath) {
      const watchers = this.watchersByMind.get(mindPath) ?? [];
      for (const w of watchers) w.close();
      this.watchersByMind.delete(mindPath);
      const timer = this.scanTimersByMind.get(mindPath);
      if (timer) clearTimeout(timer);
      this.scanTimersByMind.delete(mindPath);
    } else {
      for (const watchers of this.watchersByMind.values()) {
        for (const w of watchers) w.close();
      }
      this.watchersByMind.clear();
      for (const timer of this.scanTimersByMind.values()) clearTimeout(timer);
      this.scanTimersByMind.clear();
    }
  }

  removeMind(mindPath: string): void {
    this.stopWatching(mindPath);
    this.viewsByMind.delete(mindPath);
  }
}
