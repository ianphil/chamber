import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { MarketplaceRegistryService } from '@chamber/services';

interface MarketplaceIPCOptions {
  onRegistryToolsChanged?: () => void;
}

export function setupMarketplaceIPC(
  marketplaceRegistryService: MarketplaceRegistryService,
  options: MarketplaceIPCOptions = {},
): void {
  ipcMain.handle(IPC.MARKETPLACE.LIST_GENESIS_REGISTRIES, async () => {
    return marketplaceRegistryService.listGenesisRegistries();
  });

  ipcMain.handle(IPC.MARKETPLACE.ADD_GENESIS_REGISTRY, async (_event, url: string) => {
    const result = await marketplaceRegistryService.addGenesisRegistry(url);
    if (result.success) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle(IPC.MARKETPLACE.REFRESH_GENESIS_REGISTRY, async (_event, id: string) => {
    const result = await marketplaceRegistryService.refreshGenesisRegistry(id);
    if (result.success) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle(IPC.MARKETPLACE.SET_GENESIS_REGISTRY_ENABLED, async (_event, id: string, enabled: boolean) => {
    const result = await marketplaceRegistryService.setGenesisRegistryEnabled(id, enabled);
    if (result.success && enabled) options.onRegistryToolsChanged?.();
    return result;
  });

  ipcMain.handle(IPC.MARKETPLACE.REMOVE_GENESIS_REGISTRY, async (_event, id: string) => {
    return marketplaceRegistryService.removeGenesisRegistry(id);
  });
}
