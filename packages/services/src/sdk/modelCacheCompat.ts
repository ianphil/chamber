interface CopilotClientWithModelCache {
  modelsCache?: unknown | null;
}

/**
 * Defensive no-op against any future @github/copilot-sdk that re-introduces
 * an SDK-level model cache.
 *
 * As of @github/copilot-sdk@0.3.0 the public CopilotClient has no
 * `modelsCache` field — `client.listModels()` is a thin wrapper around
 * `connection.sendRequest("models.list", {})`. The cache that actually
 * controls model freshness lives in the CLI server process (a 30-minute
 * in-memory `static Map` in node_modules/@github/copilot/app.js) and can
 * only be busted by restarting the CLI subprocess.
 *
 * See docs/model-cache-investigation.md (issue #90) for the full picture.
 */
export function clearCopilotModelsCache(client: object): void {
  const cachedClient = client as CopilotClientWithModelCache;
  if ('modelsCache' in cachedClient) {
    cachedClient.modelsCache = null;
  }
}
