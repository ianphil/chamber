# Model-Cache Investigation (Issue #90)

## Problem statement

User report (issue [#90][issue-90]): newly enabled GitHub Copilot models do not
appear in the Chamber model picker after restarting the app. The fix is gated on
*understanding where the cache actually lives* before we ship a "Refresh
models" affordance — see issue body, "Don't ship a Refresh models button until
we know the cache TTL."

## Components in the read path

```
renderer (apps/web)
  useAppSubscriptions [hooks/useAppSubscriptions.ts:38]
    -> window.electronAPI.chat.listModels(mindId)
       -> ChatService.listModels [packages/services/src/chat/ChatService.ts:262]
          -> clearCopilotModelsCache(client)   [SDK 0.2.x compat shim]
          -> client.listModels()
             -> connection.sendRequest("models.list", {})
                -> CLI server process (node_modules/@github/copilot/app.js)
                   -> static listModelsCache  Map  (30 min TTL)
                      -> fetch ${baseURL}/models   (GitHub Copilot API)
```

There are exactly **three** caches in this path. Two are no-ops, one is the
real one.

### 1. Renderer-side: no cache

`useAppSubscriptions.ts:38` re-fetches the model list every time the active
mind changes. There is no React-level cache, no `useMemo` of the model
list, no localStorage write. The renderer is always one IPC round-trip away
from a fresh `chat:listModels` call.

The existing comment ("no cache — always fresh") is **misleading** — the
renderer does not cache, but the SDK + CLI below it do. Updated to make this
explicit.

### 2. SDK-side (`@github/copilot-sdk@0.3.0`): no real cache

`packages/services/src/sdk/modelCacheCompat.ts` — `clearCopilotModelsCache`
nulls a `client.modelsCache` field. **In SDK 0.3.0 that field does not
exist on the public `CopilotClient`.** The shim is a no-op against the
current pinned SDK; it is kept only to defend against a future `@github/copilot-sdk`
that re-introduces an SDK-level cache.

Inspecting the bundled SDK (`node_modules/@github/copilot/copilot-sdk/index.js:5233`)
confirms `listModels()` simply does
`await this.connection.sendRequest("models.list", {})` and returns the raw
response — no caching layer, no de-duplication.

### 3. CLI server-side: **the real cache** — 30 min TTL, in-memory only

The cache that actually controls model freshness lives in the **CLI server
process** that the SDK talks to over JSON-RPC. From
`node_modules/@github/copilot/app.js:1263` (the API client class that owns the
`/models` HTTP request):

```js
static LIST_MODELS_MAX_RETRIES = 2;
static LIST_MODELS_RETRY_DELAY_MS = 500;
static LIST_MODELS_CACHE_TTL_MS = 1800 * 1e3;       // 30 min
static listModelsCache = new Map();
static clearListModelsCache() { t.listModelsCache.clear(); }

get listModelsCacheKey() {
  let r = this.headers.Authorization || this.headers["X-GitHub-User"] || "";
  return `${this.baseURL}:${r}`;
}

async listModels(r) {
  // ...
  let o = t.listModelsCache.get(this.listModelsCacheKey);
  if (o && Date.now() - o.timestamp < t.LIST_MODELS_CACHE_TTL_MS) {
    // return cached
  }
  // ...fetch + cache
}
```

Properties of this cache:

- **Storage**: `static Map` on a class — pure in-memory, per CLI process.
- **TTL**: **1,800,000 ms = 30 minutes**.
- **Key**: `${baseURL}:${Authorization-or-X-GitHub-User}`.
- **No on-disk persistence.** The diagnostic script `scripts/diagnose-model-cache.js`
  walks every cache/home directory the CLI loader resolves
  (`%LOCALAPPDATA%\copilot\`, `~/.copilot/`, `~/.cache/copilot/`,
  `~/.config/copilot/`, `~/.config/github-copilot/`, plus their `pkg/`
  subdirs) and finds zero model-shaped JSON. Re-run after a fresh
  `client.listModels()` call: still zero. The cache exists *only* as long as
  the CLI subprocess is alive.
- **No remote-clear hook.** `clearListModelsCache()` is defined as a static
  method but is **never invoked anywhere in the bundle** — there is no
  JSON-RPC method exposed to the SDK that clears it. (Confirmed via
  `Select-String` for `clearListModelsCache|listModelsCache|LIST_MODELS_CACHE`
  in the entire `app.js` bundle: exactly one match — the definition itself.)

### Implication for #90

`CopilotClient` is created per mind (`packages/services/src/sdk/CopilotClientFactory.ts:23`),
and `client.stop()` (called by `CopilotClientFactory.destroyClient`) tears down
the underlying CLI subprocess. **Killing the CopilotClient kills the cache.**

So the user's "models don't appear after restart" experience is caused by one
of two things:

1. **Within the 30 min TTL after the SDK first listed models, the CLI
   subprocess is still alive and serving the cached map.** Even though the
   renderer re-fires `listModels` on every mind switch, the CLI returns the
   same stale list until either (a) the CLI process exits, or (b) 30 minutes
   pass since the last fetch.
2. **A brand-new model is enabled while Chamber is running.** Since chamber
   keeps a `CopilotClient` (and therefore a CLI subprocess) per mind alive
   for the lifetime of that mind, the model only appears once the user
   either restarts Chamber or deactivates+reactivates the mind (which calls
   `destroyClient` → `createClient` and spawns a fresh CLI process).

If the user restarts Chamber and the mind still doesn't see the new model,
the most likely cause is *not* this cache (a fresh process means a fresh
`Map`). It's worth verifying that `app.on('before-quit')` actually awaits
`destroyClient` for every mind before exit, and that the user doesn't have
multiple `electron.exe` processes lingering from a non-clean shutdown.

## Recommendation for the C2 fix PR

The right shape for the fix is now clear:

1. **No on-disk cache file to delete.** Drop any plan to ship a "delete the
   cache file" code path.
2. **No remote-clear JSON-RPC method.** Drop any plan to call a
   `models.clearCache` or similar — it doesn't exist.
3. **The only way to bust the cache is to restart the CLI subprocess.**
   The "Refresh models" affordance should call
   `factory.destroyClient(client)` followed by `factory.createClient(mindPath)`
   for the active mind, then re-run `listModels`. This is heavy
   (kills the CLI subprocess), so it must be a deliberate user action,
   not auto-triggered.
4. **Update the misleading comments.** This PR fixes the "no cache — always
   fresh" comment in `useAppSubscriptions.ts` and the "caches models forever
   per CopilotClient instance" comment in `ChatService.ts`. Both pre-date
   SDK 0.3.0 and are now wrong.
5. **Keep `clearCopilotModelsCache`.** It is a no-op against SDK 0.3.0 but
   it costs nothing and defends against a future SDK regression that
   re-introduces an SDK-level cache. Document this in the shim itself.

## Files touched in this PR

- **Add**: `scripts/diagnose-model-cache.js` — passive read-only probe used
  to confirm the no-on-disk-cache claim. Re-runnable on any platform.
- **Add**: `docs/model-cache-investigation.md` — this document.
- **Edit**: `packages/services/src/sdk/modelCacheCompat.ts` — JSDoc that
  spells out the SDK 0.3.0 reality so the shim isn't mistaken for the
  primary refresh mechanism.
- **Edit**: `packages/services/src/chat/ChatService.ts:265-267` — replace
  the misleading comment with a pointer to this document.
- **Edit**: `apps/web/src/renderer/hooks/useAppSubscriptions.ts:38` —
  replace "no cache — always fresh" with a comment that admits the 30 min
  CLI-side TTL.

No production behavior change in this PR. Refs #90.

[issue-90]: https://github.com/ianphil/chamber/issues/90
