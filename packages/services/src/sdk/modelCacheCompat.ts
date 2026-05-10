interface CopilotClientWithModelCache {
  modelsCache?: unknown | null;
}

export function clearCopilotModelsCache(client: object): void {
  const cachedClient = client as CopilotClientWithModelCache;
  if ('modelsCache' in cachedClient) {
    cachedClient.modelsCache = null;
  }
}
