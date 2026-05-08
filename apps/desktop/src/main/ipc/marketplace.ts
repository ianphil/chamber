import { ipcMain } from 'electron';
import type { MarketplaceRegistryService } from '@chamber/services';

interface MarketplaceIPCOptions {
  onRegistryToolsChanged?: () => void;
}

export function setupMarketplaceIPC(
  marketplaceRegistryService: MarketplaceRegistryService,
  options: MarketplaceIPCOptions = {},
): void {
  ipcMain.handle('marketplace:listGenesisRegistries', async () => {
    return marketplaceRegistryService.listGenesisRegistries();
  });

  ipcMain.handle('marketplace:addGenesisRegistry', async (_event, url: string) => {
    const result = await marketplaceRegistryService.addGenesisRegistry(url);
    if (result.success) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle('marketplace:refreshGenesisRegistry', async (_event, id: string) => {
    const result = await marketplaceRegistryService.refreshGenesisRegistry(id);
    if (result.success) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle('marketplace:setGenesisRegistryEnabled', async (_event, id: string, enabled: boolean) => {
    const result = await marketplaceRegistryService.setGenesisRegistryEnabled(id, enabled);
    if (result.success && enabled) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle('marketplace:removeGenesisRegistry', async (_event, id: string) => {
    return marketplaceRegistryService.removeGenesisRegistry(id);
  });
}
