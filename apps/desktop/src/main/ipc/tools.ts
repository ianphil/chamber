import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { ToolsService } from '@chamber/services';

export function setupToolsIPC(toolsService: ToolsService): void {
  ipcMain.handle(IPC.TOOLS.LIST, async () => toolsService.list());
  ipcMain.handle(IPC.TOOLS.INSTALL, async (_event, toolId: string, marketplaceId?: string) =>
    toolsService.install(toolId, marketplaceId),
  );
  ipcMain.handle(IPC.TOOLS.UNINSTALL, async (_event, toolId: string) => toolsService.uninstall(toolId));
}
