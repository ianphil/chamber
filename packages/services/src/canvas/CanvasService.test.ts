import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasService } from './CanvasService';
import type { CanvasServerLike } from './types';

const tempDirs: string[] = [];

function makeMindPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-canvas-service-'));
  tempDirs.push(dir);
  return dir;
}

class MockCanvasServer implements CanvasServerLike {
  private port: number | null = null;

  readonly start = vi.fn(async () => {
    if (this.port === null) {
      this.port = 4312;
    }
    return this.port;
  });

  readonly stop = vi.fn(async () => {
    this.port = null;
  });

  readonly reload = vi.fn();
  readonly closeClients = vi.fn();

  readonly getPort = vi.fn(() => this.port);
  readonly isRunning = vi.fn(() => this.port !== null);
}

describe('CanvasService', () => {
  let server: MockCanvasServer;
  let openedUrls: string[];
  let service: CanvasService;

  beforeEach(() => {
    server = new MockCanvasServer();
    openedUrls = [];
    service = new CanvasService({
      openExternal: { open: (url) => { openedUrls.push(url); } },
      server,
    });
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('activateMind creates the .chamber\\canvas directory', async () => {
    const mindPath = makeMindPath();

    await service.activateMind('mind-1', mindPath);

    expect(fs.existsSync(path.join(mindPath, '.chamber', 'canvas'))).toBe(true);
  });

  it('shows a wrapped canvas, starts the server, and opens the browser by default', async () => {
    const mindPath = makeMindPath();

    const result = await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Plan</h1>',
      name: 'daily-plan',
    });

    const contentPath = path.join(mindPath, '.chamber', 'canvas', 'daily-plan.html');
    const content = fs.readFileSync(contentPath, 'utf8');

    expect(server.start).toHaveBeenCalledOnce();
    expect(openedUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:4312\/mind-1\/daily-plan\.html\?token=[A-Za-z0-9_-]+$/);
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('<h1>Plan</h1>');
    expect(result).toContain('opened in browser');
    expect(service.listCanvases('mind-1', mindPath)).toContain('daily-plan');
  });

  it('can copy an existing html file without opening the browser', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, 'source.html');
    fs.writeFileSync(sourceFile, '<html><body>From file</body></html>', 'utf8');

    const result = await service.showCanvas('mind-1', mindPath, {
      file: sourceFile,
      name: 'copied',
      open_browser: false,
    });

    const copied = fs.readFileSync(path.join(mindPath, '.chamber', 'canvas', 'copied.html'), 'utf8');
    expect(copied).toBe('<html><body>From file</body></html>');
    expect(openedUrls).toHaveLength(0);
    expect(result).toMatch(/http:\/\/127\.0\.0\.1:4312\/mind-1\/copied\.html\?token=[A-Za-z0-9_-]+/);
  });

  it('serves a Lens html source as an embedded canvas without opening the browser', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, '.github', 'lens', 'command-center', 'index.html');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, '<html><body>Command</body></html>', 'utf8');

    const url = await service.showLensCanvas('mind-1', mindPath, 'command-center', sourceFile);

    expect(server.start).toHaveBeenCalledOnce();
    expect(openedUrls).toHaveLength(0);
    const servedFilename = new URL(url).pathname.split('/').pop();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4312\/mind-1\/lens-[a-f0-9]{16}\.html\?token=[A-Za-z0-9_-]+$/);
    expect(fs.readFileSync(path.join(mindPath, '.chamber', 'canvas', servedFilename ?? ''), 'utf8')).toContain('Command');
    expect(server.reload).toHaveBeenCalledWith('mind-1', servedFilename);
  });

  it('rejects embedded Lens canvas sources outside the mind lens directory', async () => {
    const mindPath = makeMindPath();
    const sourceFile = path.join(mindPath, 'outside.html');
    fs.writeFileSync(sourceFile, '<html><body>Outside</body></html>', 'utf8');

    await expect(service.showLensCanvas('mind-1', mindPath, 'outside', sourceFile))
      .rejects.toThrow('inside the mind .github/lens directory');
  });

  it('updates an existing canvas and triggers targeted reload', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Before</h1>',
      name: 'report',
      open_browser: false,
    });

    const result = service.updateCanvas('mind-1', mindPath, {
      html: '<h1>After</h1>',
      name: 'report',
    });

    const content = fs.readFileSync(path.join(mindPath, '.chamber', 'canvas', 'report.html'), 'utf8');
    expect(content).toContain('<h1>After</h1>');
    expect(server.reload).toHaveBeenCalledWith('mind-1', 'report.html');
    expect(result).toContain('updated');
  });

  it('closes a single canvas, removes its file, and stops the server when it was the last one', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Report</h1>',
      name: 'report',
      open_browser: false,
    });

    const result = await service.closeCanvas('mind-1', mindPath, {
      name: 'report',
    });

    expect(server.closeClients).toHaveBeenCalledWith('mind-1', 'report.html');
    expect(server.stop).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(mindPath, '.chamber', 'canvas', 'report.html'))).toBe(false);
    expect(result).toContain('Server stopped');
  });

  it('close all only affects the current mind and keeps the server running if others remain', async () => {
    const mindPathA = makeMindPath();
    const mindPathB = makeMindPath();

    await service.showCanvas('mind-a', mindPathA, {
      html: '<h1>A</h1>',
      name: 'alpha',
      open_browser: false,
    });
    await service.showCanvas('mind-b', mindPathB, {
      html: '<h1>B</h1>',
      name: 'beta',
      open_browser: false,
    });

    const result = await service.closeCanvas('mind-a', mindPathA, {
      name: 'all',
    });

    expect(server.closeClients).toHaveBeenCalledWith('mind-a');
    expect(server.stop).not.toHaveBeenCalled();
    expect(result).toContain('1 canvas(es) still active');
    expect(service.listCanvases('mind-b', mindPathB)).toContain('beta');
  });

  it('releaseMind closes that mind clients and stops the server when no canvases remain', async () => {
    const mindPath = makeMindPath();
    await service.showCanvas('mind-1', mindPath, {
      html: '<h1>Report</h1>',
      name: 'report',
      open_browser: false,
    });

    await service.releaseMind('mind-1');

    expect(server.closeClients).toHaveBeenCalledWith('mind-1');
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it('rejects invalid names and missing content', async () => {
    const mindPath = makeMindPath();

    await expect(service.showCanvas('mind-1', mindPath, {
      html: '<h1>Bad</h1>',
      name: '../bad',
    })).rejects.toThrow('Invalid canvas name');

    await expect(service.showCanvas('mind-1', mindPath, {
      name: 'empty',
    })).rejects.toThrow('canvas_show requires either "html" or "file"');
  });
});
