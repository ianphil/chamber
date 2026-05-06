import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '../logger';
import type { ChamberToolProvider } from '../chamberTools';

const log = Logger.create('canvas');
import type { Tool } from '../mind/types';
import type { ExternalOpener } from '../ports';
import { CanvasServer } from './CanvasServer';
import { buildCanvasTools } from './tools';
import type {
  CanvasAction,
  CanvasCloseInput,
  CanvasEntry,
  CanvasServerLike,
  CanvasShowInput,
  CanvasUpdateInput,
} from './types';

const CANVAS_DIR = path.join('.chamber', 'canvas');
const VALID_CANVAS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface CanvasServiceOptions {
  onAction?: (action: CanvasAction) => void;
  openExternal?: ExternalOpener;
  server?: CanvasServerLike;
}

function validateCanvasName(name: string): void {
  if (name === 'all') {
    throw new Error('"all" is reserved for canvas_close and cannot be used as a canvas name');
  }

  if (!VALID_CANVAS_NAME.test(name)) {
    throw new Error(`Invalid canvas name "${name}". Use letters, numbers, dots, underscores, or hyphens.`);
  }
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function wrapHtml(name: string, html: string, title?: string): string {
  const lowerCaseHtml = html.toLowerCase();
  if (!lowerCaseHtml.includes('<!doctype') && !lowerCaseHtml.includes('<html')) {
    const pageTitle = title ?? name;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
</head>
<body>
${html}
</body>
</html>`;
  }

  if (title && !lowerCaseHtml.includes('<title>')) {
    return html.replace('</head>', `  <title>${title}</title>\n</head>`);
  }

  return html;
}

export class CanvasService implements ChamberToolProvider {
  private readonly mindPaths = new Map<string, string>();
  private readonly canvases = new Map<string, Map<string, CanvasEntry>>();
  private readonly lensViewIdsByCanvas = new Map<string, Map<string, string>>();
  private readonly server: CanvasServerLike;
  private readonly openExternal: ExternalOpener;
  private readonly onAction: (action: CanvasAction) => void;

  constructor(options: CanvasServiceOptions = {}) {
    this.onAction = options.onAction ?? ((action: CanvasAction) => {
      log.info('Action received:', action);
    });

    this.server = options.server ?? new CanvasServer({
      resolveContentDir: (mindId) => this.getContentDirForMind(mindId),
      onAction: (action) => this.onAction(this.decorateCanvasAction(action)),
      authorizeRequest: (mindId, filename, token) => this.isAuthorizedCanvasRequest(mindId, filename, token),
    });
    this.openExternal = options.openExternal ?? {
      open: () => {
        throw new Error('CanvasService requires an ExternalOpener adapter');
      },
    };
  }

  getToolsForMind(mindId: string, mindPath: string): Tool[] {
    return buildCanvasTools(mindId, mindPath, this) as Tool[];
  }

  async activateMind(mindId: string, mindPath: string): Promise<void> {
    this.ensureMind(mindId, mindPath);
  }

  async releaseMind(mindId: string): Promise<void> {
    this.server.closeClients(mindId);
    this.canvases.delete(mindId);
    this.lensViewIdsByCanvas.delete(mindId);
    this.mindPaths.delete(mindId);
    await this.stopServerIfIdle();
  }

  async showCanvas(mindId: string, mindPath: string, input: CanvasShowInput): Promise<string> {
    validateCanvasName(input.name);
    if (!input.html && !input.file) {
      throw new Error('canvas_show requires either "html" or "file"');
    }

    const contentDir = this.ensureMind(mindId, mindPath);
    const filename = `${input.name}.html`;
    const targetPath = path.join(contentDir, filename);

    if (input.file) {
      if (!path.isAbsolute(input.file)) {
        throw new Error('canvas_show file must be an absolute path');
      }
      if (!fs.existsSync(input.file)) {
        throw new Error(`Canvas source file not found: ${input.file}`);
      }
      fs.copyFileSync(input.file, targetPath);
    } else {
      fs.writeFileSync(targetPath, wrapHtml(input.name, input.html ?? '', input.title), 'utf8');
    }

    const port = await this.server.start();
    const token = this.getExistingToken(mindId, input.name) ?? createCanvasToken();
    const url = this.buildCanvasUrl(mindId, filename, port, token);
    this.upsertCanvas(mindId, {
      filename,
      name: input.name,
      url,
      token,
    });

    if (input.open_browser !== false) {
      await this.openExternal.open(url);
      return `Canvas **${input.name}** is live at ${url} (opened in browser)`;
    }

    return `Canvas **${input.name}** is live at ${url}`;
  }

  async showLensCanvas(mindId: string, mindPath: string, viewId: string, sourcePath: string): Promise<string> {
    if (!path.isAbsolute(sourcePath)) {
      throw new Error('Canvas Lens source path must be absolute');
    }
    const lensDir = path.join(mindPath, '.github', 'lens');
    if (!isPathInside(lensDir, sourcePath)) {
      throw new Error('Canvas Lens source path must be inside the mind .github/lens directory');
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Canvas Lens source file not found: ${sourcePath}`);
    }

    const contentDir = this.ensureMind(mindId, mindPath);
    const name = this.getLensCanvasName(viewId);
    const filename = `${name}.html`;
    fs.copyFileSync(sourcePath, path.join(contentDir, filename));

    const port = await this.server.start();
    const token = this.getExistingToken(mindId, name) ?? createCanvasToken();
    const url = this.buildCanvasUrl(mindId, filename, port, token);
    this.upsertCanvas(mindId, {
      filename,
      name,
      url,
      token,
    });

    const lensViews = this.lensViewIdsByCanvas.get(mindId) ?? new Map<string, string>();
    lensViews.set(filename, viewId);
    this.lensViewIdsByCanvas.set(mindId, lensViews);
    this.server.reload(mindId, filename);

    return url;
  }

  updateCanvas(mindId: string, mindPath: string, input: CanvasUpdateInput): string {
    validateCanvasName(input.name);
    const contentDir = this.ensureMind(mindId, mindPath);
    const existing = this.requireCanvas(mindId, input.name);
    fs.writeFileSync(
      path.join(contentDir, existing.filename),
      wrapHtml(input.name, input.html, input.title),
      'utf8',
    );
    this.server.reload(mindId, existing.filename);
    return `Canvas **${input.name}** updated. Browser will auto-reload.`;
  }

  async closeCanvas(mindId: string, mindPath: string, input: CanvasCloseInput): Promise<string> {
    this.ensureMind(mindId, mindPath);
    if (input.name === 'all') {
      return this.closeAllCanvases(mindId);
    }

    validateCanvasName(input.name);
    const existing = this.requireCanvas(mindId, input.name);
    this.server.closeClients(mindId, existing.filename);

    const canvases = this.canvases.get(mindId);
    canvases?.delete(input.name);
    this.removeLensCanvasMapping(mindId, existing.filename);
    if (canvases && canvases.size === 0) {
      this.canvases.delete(mindId);
    }

    this.deleteCanvasFile(mindId, existing.filename);
    const remaining = this.totalCanvasCount();
    if (remaining === 0) {
      await this.server.stop();
      return `Canvas **${input.name}** closed. Server stopped (no remaining canvases).`;
    }

    return `Canvas **${input.name}** closed. ${remaining} canvas(es) still active.`;
  }

  listCanvases(mindId: string, mindPath: string): string {
    this.ensureMind(mindId, mindPath);
    const canvases = this.canvases.get(mindId);
    if (!canvases || canvases.size === 0) {
      return 'No canvases are open.';
    }

    const lines = [...canvases.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `- **${entry.name}** - ${entry.url}`);

    const status = this.server.isRunning()
      ? `Server running on port ${this.server.getPort()}`
      : 'Server not running';

    return `${lines.join('\n')}\n\n${status}`;
  }

  private async closeAllCanvases(mindId: string): Promise<string> {
    const canvases = this.canvases.get(mindId);
    if (!canvases || canvases.size === 0) {
      return 'No canvases are open.';
    }

    this.server.closeClients(mindId);
    const count = canvases.size;
    for (const entry of canvases.values()) {
      this.deleteCanvasFile(mindId, entry.filename);
      this.removeLensCanvasMapping(mindId, entry.filename);
    }
    this.canvases.delete(mindId);

    const remaining = this.totalCanvasCount();
    if (remaining === 0) {
      await this.server.stop();
      return `Closed ${count} canvas(es) and stopped the server.`;
    }

    return `Closed ${count} canvas(es). ${remaining} canvas(es) still active.`;
  }

  private ensureMind(mindId: string, mindPath: string): string {
    this.mindPaths.set(mindId, mindPath);
    const contentDir = path.join(mindPath, CANVAS_DIR);
    fs.mkdirSync(contentDir, { recursive: true });
    return contentDir;
  }

  private requireCanvas(mindId: string, name: string): CanvasEntry {
    const existing = this.canvases.get(mindId)?.get(name);
    if (!existing) {
      throw new Error(`Canvas "${name}" not found. Use canvas_show to create it first.`);
    }
    return existing;
  }

  private getContentDirForMind(mindId: string): string | null {
    const mindPath = this.mindPaths.get(mindId);
    return mindPath ? path.join(mindPath, CANVAS_DIR) : null;
  }

  private upsertCanvas(mindId: string, entry: CanvasEntry): void {
    const canvases = this.canvases.get(mindId) ?? new Map<string, CanvasEntry>();
    canvases.set(entry.name, entry);
    this.canvases.set(mindId, canvases);
  }

  private buildCanvasUrl(mindId: string, filename: string, port: number, token: string): string {
    return `http://127.0.0.1:${port}/${encodeURIComponent(mindId)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
  }

  private getLensCanvasName(viewId: string): string {
    const digest = createHash('sha256').update(viewId).digest('hex').slice(0, 16);
    return `lens-${digest}`;
  }

  private decorateCanvasAction(action: CanvasAction): CanvasAction {
    const lensViewId = this.lensViewIdsByCanvas.get(action.mindId)?.get(action.canvas);
    return lensViewId ? { ...action, lensViewId } : action;
  }

  private getExistingToken(mindId: string, name: string): string | null {
    return this.canvases.get(mindId)?.get(name)?.token ?? null;
  }

  private isAuthorizedCanvasRequest(mindId: string, filename: string, token: string | null): boolean {
    if (!token) return false;
    const canvases = this.canvases.get(mindId);
    if (!canvases) return false;
    const normalizedFilename = filename.replace(/\\/g, '/');
    for (const canvas of canvases.values()) {
      if (canvas.filename === normalizedFilename && canvas.token === token) {
        return true;
      }
    }
    return false;
  }

  private removeLensCanvasMapping(mindId: string, filename: string): void {
    const lensViews = this.lensViewIdsByCanvas.get(mindId);
    lensViews?.delete(filename);
    if (lensViews?.size === 0) {
      this.lensViewIdsByCanvas.delete(mindId);
    }
  }

  private deleteCanvasFile(mindId: string, filename: string): void {
    const contentDir = this.getContentDirForMind(mindId);
    if (!contentDir) {
      return;
    }

    fs.rmSync(path.join(contentDir, filename), { force: true });
  }

  private totalCanvasCount(): number {
    let count = 0;
    for (const canvases of this.canvases.values()) {
      count += canvases.size;
    }
    return count;
  }

  private async stopServerIfIdle(): Promise<void> {
    if (this.totalCanvasCount() === 0 && this.server.isRunning()) {
      await this.server.stop();
    }
  }
}

function createCanvasToken(): string {
  return randomBytes(32).toString('base64url');
}
