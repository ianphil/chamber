import { ipcMain } from 'electron';
import type { ToolsService } from '@chamber/services';

export function setupToolsIPC(toolsService: ToolsService): void {
  ipcMain.handle('tools:list', async () => toolsService.list());
  ipcMain.handle('tools:install', async (_event, toolId: string, marketplaceId?: string) =>
    toolsService.install(toolId, marketplaceId),
  );
  ipcMain.handle('tools:uninstall', async (_event, toolId: string) => toolsService.uninstall(toolId));
}
