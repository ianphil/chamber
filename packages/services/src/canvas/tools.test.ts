import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasService } from './CanvasService';
import { buildCanvasTools } from './tools';

const mockService = {
  closeCanvas: vi.fn(),
  listCanvases: vi.fn(),
  showCanvas: vi.fn(),
  updateCanvas: vi.fn(),
};

describe('buildCanvasTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 4 tools with the expected names', () => {
    const tools = buildCanvasTools('mind-1', 'C:\\minds\\one', mockService as unknown as CanvasService);

    expect(tools).toHaveLength(4);
    expect(tools.map((tool) => tool.name)).toEqual([
      'canvas_show',
      'canvas_update',
      'canvas_close',
      'canvas_list',
    ]);
  });

  it('canvas_show dispatches to CanvasService.showCanvas', async () => {
    const tools = buildCanvasTools('mind-1', 'C:\\minds\\one', mockService as unknown as CanvasService);
    const show = tools.find((tool) => tool.name === 'canvas_show');
    if (!show) {
      throw new Error('Expected canvas_show tool');
    }

    const input = { html: '<h1>Plan</h1>', name: 'plan' };
    await show.handler(input);

    expect(mockService.showCanvas).toHaveBeenCalledWith('mind-1', 'C:\\minds\\one', input);
  });

  it('canvas_update dispatches to CanvasService.updateCanvas', async () => {
    const tools = buildCanvasTools('mind-1', 'C:\\minds\\one', mockService as unknown as CanvasService);
    const update = tools.find((tool) => tool.name === 'canvas_update');
    if (!update) {
      throw new Error('Expected canvas_update tool');
    }

    const input = { html: '<h1>Updated</h1>', name: 'plan' };
    await update.handler(input);

    expect(mockService.updateCanvas).toHaveBeenCalledWith('mind-1', 'C:\\minds\\one', input);
  });

  it('canvas_close dispatches to CanvasService.closeCanvas', async () => {
    const tools = buildCanvasTools('mind-1', 'C:\\minds\\one', mockService as unknown as CanvasService);
    const close = tools.find((tool) => tool.name === 'canvas_close');
    if (!close) {
      throw new Error('Expected canvas_close tool');
    }

    await close.handler({ name: 'plan' });

    expect(mockService.closeCanvas).toHaveBeenCalledWith('mind-1', 'C:\\minds\\one', { name: 'plan' });
  });

  it('canvas_list dispatches to CanvasService.listCanvases', async () => {
    const tools = buildCanvasTools('mind-1', 'C:\\minds\\one', mockService as unknown as CanvasService);
    const list = tools.find((tool) => tool.name === 'canvas_list');
    if (!list) {
      throw new Error('Expected canvas_list tool');
    }

    await list.handler({});

    expect(mockService.listCanvases).toHaveBeenCalledWith('mind-1', 'C:\\minds\\one');
  });
});
