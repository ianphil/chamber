import type { SessionTool } from '../a2a/tools';
import type { CanvasService } from './CanvasService';
import type { CanvasCloseInput, CanvasShowInput, CanvasUpdateInput } from './types';

export function buildCanvasTools(
  mindId: string,
  mindPath: string,
  canvasService: CanvasService,
): SessionTool[] {
  return [
    {
      name: 'canvas_show',
      description:
        'Display HTML content in the browser. Creates a local canvas page and opens it in the default browser. Use this for dashboards, reports, forms, or any rich visual output.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Canvas identifier. Use letters, numbers, dots, underscores, or hyphens.',
          },
          html: {
            type: 'string',
            description: 'HTML content to display. Can be a complete page or fragment.',
          },
          file: {
            type: 'string',
            description: 'Absolute path to an existing HTML file to copy into the canvas content directory.',
          },
          title: {
            type: 'string',
            description: 'Optional page title if html does not already include one.',
          },
          open_browser: {
            type: 'boolean',
            description: 'Whether to open the browser. Defaults to true.',
          },
        },
        required: ['name'],
      },
      handler: async (args) => canvasService.showCanvas(mindId, mindPath, args as unknown as CanvasShowInput),
    },
    {
      name: 'canvas_update',
      description: 'Update an existing canvas. The browser auto-reloads via server-sent events.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Canvas name to update.',
          },
          html: {
            type: 'string',
            description: 'New HTML content to display.',
          },
          title: {
            type: 'string',
            description: 'Optional updated page title.',
          },
        },
        required: ['name', 'html'],
      },
      handler: async (args) => canvasService.updateCanvas(mindId, mindPath, args as unknown as CanvasUpdateInput),
    },
    {
      name: 'canvas_close',
      description: 'Close a canvas. Use "all" to close every canvas for this mind.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Canvas name to close, or "all" to close every canvas for this mind.',
          },
        },
        required: ['name'],
      },
      handler: async (args) => canvasService.closeCanvas(mindId, mindPath, args as unknown as CanvasCloseInput),
    },
    {
      name: 'canvas_list',
      description: 'List the currently open canvases for this mind.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => canvasService.listCanvases(mindId, mindPath),
    },
  ];
}
