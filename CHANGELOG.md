# Changelog

## v0.59.5 (2026-05-10)

### Refactoring

- **Extract MagenticStrategy prompts and parsers; replace unsafe `abortController!` assertions with a guarded helper** — Two clusters of TS3 + TS7 from the 2026-05-10 codebase review. The 744-LOC `MagenticStrategy.ts` (a security-critical orchestration surface per `AGENTS.md`) shrinks to 543 LOC by extracting `formatManagerResponse`, `parseManagerResponse`, `ManagerDecision`, and `failTask` into `magenticParsers.ts` and the four prompt builders (`buildPlanPrompt`, `buildAssignPrompt`, `buildWorkerPrompt`, `buildSynthesisPrompt`) into `magenticPrompts.ts` as pure functions. The runner methods (`runWorkerTask`, `executeAssignments`, `resolveAssignments`) remain on the class and are deferred to a follow-up — extracting them safely requires explicit dependency injection of the controller, unsubs, and worker timeout. `BaseStrategy` gains `protected requireAbortController(): AbortController` that throws a named error when the controller is missing instead of producing a deep TypeError inside the SDK call site; every `this.abortController!.signal` across `MagenticStrategy`, `GroupChatStrategy`, `HandoffStrategy`, and `SequentialStrategy` is replaced. Closes #276.

## v0.59.4 (2026-05-10)

### Security

- **Add Content-Security-Policy and lock down `setPermissionRequestHandler`** — Two missing Electron security checklist items. The renderer now receives a strict CSP via `session.webRequest.onHeadersReceived`: production uses `script-src 'self'`; development adds `'unsafe-eval'` only because Vite's HMR transform requires it. Both modes set `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'none'`, `base-uri 'self'`, with `connect-src` allow-listed to `'self'` plus `https://api.github.com`, `https://api.githubcopilot.com`, `https://github.com`, and `localhost` for the loopback server and HMR. `session.setPermissionRequestHandler` and `setPermissionCheckHandler` now allow only `notifications` and deny every other Chromium permission (`media`, `geolocation`, `midi`, `pointerLock`, `fullscreen`, `clipboard-read`, ...), so a compromised mind canvas or Lens view cannot silently capture the microphone or camera. With `sandbox: false` (justified by the Copilot SDK preload bridge) these two controls are the highest-leverage XSS mitigations Chamber can adopt without regressing the SDK contract. Composition root in `apps/desktop/src/main.ts` wires the helpers; pure logic lives in `apps/desktop/src/main/security/sessionSecurity.ts` with 11 focused tests using a fake `Session`. Closes #274.

## v0.59.3 (2026-05-10)

### Refactoring

- **Decompose 838-LOC `appReducer` god-switch into per-domain reducer slices** — `apps/web/src/renderer/lib/store/reducer.ts` was a single switch statement with ~50 cases (the symptom: a 1127-LOC test file). Now `reducer.ts` is a 1-line re-export and the implementation lives in `apps/web/src/renderer/lib/store/reducers/`: `messagesReducer.ts` (chat-message + compose actions, owns the exported `handleChatEvent`), `conversationReducer.ts` (history hydration), `mindsReducer.ts` (minds + models + active mind), `lifecycleReducer.ts` (UI + account + landing), `a2aReducer.ts` (A2A messages + task updates), `chatroomReducer.ts` (every `CHATROOM_*` plus orchestration config), `helpers.ts` (shared utilities), and `index.ts` (the dispatcher: `Record<AppAction['type'], (state, action) => Partial<AppState> | AppState>` with reference-identity short-circuit for no-op handlers). All 111 reducer tests preserved unchanged as the integration safety net; behavior parity verified end-to-end. Closes #275.

## v0.59.2 (2026-05-10)

### Fixes

- **Stop the chat box from leaking memory on long replies** — Two compounding causes during streaming addressed in the renderer: (1) `react-markdown` was re-parsing the entire growing assistant message on every token because `remarkPlugins` and `rehypePlugins` were declared as inline array literals (defeating the library's internal memoization) and `TextChunk` was not memoized; (2) the `BroadcastChannel` cross-window sync effect re-published the entire `messagesByMind` map on every reducer change, structured-cloning every block of every mind per token. Plugin arrays are now module-level constants, `TextChunk` is wrapped in `React.memo`, and the `BroadcastChannel` post is coalesced via `requestAnimationFrame` so a burst of streaming chunks results in at most one cross-window post per frame. Closes #273.

## v0.59.0 (2026-05-10)

### Chat

- **"Refresh models" affordance recycles the CLI subprocess in place** — A small refresh icon next to the model picker invokes a new `chat:refreshModels` IPC channel that calls a narrow `MindManager.recycleClientForMind` (destroy SDK client → create new client → resume the active session against the fresh client) and then returns a fresh `listModels()`. This is the only way to bust the Copilot CLI's 30-minute in-memory model cache (see #270 / `docs/model-cache-investigation.md`). The active conversation is preserved, chatroom orchestration is not torn down (no `mind:unloaded` teardown), and the call is serialized through `TurnQueue` so it cannot race a queued send. Refresh is gated behind a confirm dialog and is refused when a turn is mid-stream; if the call rejects, the dialog stays open with an inline error so the user can retry or cancel. A new `mind:client-recycled` event lets `ChatroomService` drop only its cached `SessionGroup` session for the recycled mind without affecting any active orchestrator or `disabledMindIds`. Closes #90.

## v0.58.2 (2026-05-10)

### Refactoring

- **Consolidate `Logger` and `escapeXml` into `@chamber/shared`** — Two duplicate utilities had drifted in behavior. The renderer `Logger` (`apps/web/src/renderer/lib/logger.ts`) lacked `CHAMBER_LOG_LEVEL` env-var support and `resetLevel()` that the services `Logger` (`packages/services/src/logger/Logger.ts`) had; `escapeXml` had three incompatible copies (chained `.replace()` in `a2a/helpers.ts`, regex+lookup in `session-group/shared.ts`, and a 3-of-5-char version in `chat/currentDateTimeContext.ts`). One implementation each now lives in `@chamber/shared/logger` and `@chamber/shared/escapeXml`; legacy locations remain as 1-line re-exports so every existing import path continues to resolve. The `currentDateTimeContext` callsite now escapes `"` and `'` consistently with every other XML emitter — safe inside element content. Adds three new `Logger` tests for the previously-untested env-var branch. Net -257 LOC of duplicate code. Closes #272.

## v0.58.1 (2026-05-10)

### Documentation

- **Diagnose `@github/copilot` model-cache location and TTL** — Document the actual cache topology in `docs/model-cache-investigation.md`: the SDK and renderer don't cache, but the CLI subprocess holds a 30-minute in-memory `LIST_MODELS_CACHE` keyed by `${baseURL}:${Authorization}` with no on-disk persistence and no remote-clear JSON-RPC method. Adds `scripts/diagnose-model-cache.js` (read-only probe) and corrects three stale source comments that claimed no caching. Refs #90.

## v0.58.0 (2026-05-10)

### SDK

- **Per-mind tool exclusion via `.chamber.json`** — Mind authors can drop a `.chamber.json` at the mind root with `"excludedTools": ["shell", "str_replace"]` to remove specific tool names from the agent's toolset on every session create + resume. Missing file, missing key, malformed JSON, and empty arrays are all treated as no exclusions so a typo never bricks the mind. Closes #131.

## v0.57.0 (2026-05-10)

### SDK

- **Surface SDK permission requests and denials in chat** — `ChatService` now subscribes to the SDK's `permission.requested` / `permission.completed` events and emits `permission_request` / `permission_outcome` chat events, with a per-kind summary builder (paths for write, command preview for shell, URL for url, server for mcp, tool for custom-tool, hook for hook, scope for read/memory). The renderer reducer pairs requests to outcomes by `requestId` and the chat work group renders an inline permission entry that updates from pending to approved/denied with kind-appropriate icons and human-readable outcome detail. (#131)

## v0.56.0 (2026-05-10)

### SDK

- **Use session-scoped SDK permission approvals where supported** — Primary mind and Genesis SDK sessions now rely on `approveForSessionCompat`, returning session-wide approvals for read, write, and memory requests while preserving approve-once behavior for permission kinds that need richer request data. (#131)

## v0.55.0 (2026-05-10)

### SDK

- **Replace broad SDK URL auto-approval with explicit GitHub hosts** — Primary Copilot SDK sessions now drop `--allow-all-urls` and pass only the default first-party GitHub URL allowlist, leaving other URL permission requests to the SDK handler. (#131)

## v0.54.0 (2026-05-10)

### SDK

- **Replace broad SDK tool auto-approval with explicit tool kinds** — Primary Copilot SDK sessions now drop `--allow-all-tools` and pass only the side-effect tool kinds Chamber intentionally auto-approves at the CLI layer, leaving other tool permission requests to the SDK handler. (#131)

## v0.53.0 (2026-05-10)

### SDK

- **Declare explicit SDK CLI add-dir entries** — Primary Copilot SDK sessions now pass `--add-dir` for the active mind cwd and the shared `~/.chamber` root, making the allowed-path surface explicit ahead of removing broad path allowances. Closes #131.

## v0.52.2 (2026-05-10)

### Reliability

- **Split chamber-copilot scoped job IDs at the last separator** — `MindScopedJobs` now preserves mind IDs that contain `:` when validating `cli_*` job ownership, while rejecting colon-containing raw job IDs at delegate time so scoping remains unambiguous. Closes #261.

## v0.52.1 (2026-05-10)

### Dependencies

- **Pin `chamber-copilot` exactly + add a runtime surface check** — `chamber-copilot` is now pinned to `0.5.11` (no caret) in root `package.json`, mirroring the discipline already enforced for `@github/copilot` in `chamber-copilot-runtime/package.json`. A new `packages/services/src/chamberCopilot/chamber-copilot-surface.test.ts` asserts every value-level symbol our hand-rolled `chamber-copilot.d.ts` shim declares exists at runtime, that `PERMISSION_MODES`, `DEFAULT_PERMISSION_MODE`, and `YOLO_ACP_ARGS` have the documented shapes, and that `MindScopedJobs.prototype` mirrors every shim-declared `JobStore.prototype` method — so the duck-typed `scoped as unknown as JobStore` cast in `ChamberCopilotService.getToolsForMind` cannot silently regress on a future bump. Closes #260.

## v0.52.0 (2026-05-09)

### Extensions

- **Add opt-in chamber-copilot ACP extension** — Enabling `chamberCopilotEnabled: true` in `~/.chamber/config.json` wires `ChamberCopilotService` into the mind tool providers and exposes the `cli_*` ACP tools (`cli_delegate`, `cli_status`, `cli_respond`, `cli_approve`, `cli_cancel`, `cli_list`) so minds can drive child `copilot --acp` workers. Backed by the published `chamber-copilot@^0.5.11` package, paired with this PR per the upstream changelog. The connection is shared across active minds and lazy-started on first activation. The child CLI is pinned to the bundled `@github/copilot-${platform}-${arch}` binary (no PATH lookup) and spawned with chamber-copilot's `DEFAULT_ACP_ARGS` (`--acp --no-auto-update`) so cached host auth loads. Default is OFF; the existing `@github/copilot-sdk` runtime path is unchanged. Closes #258.
- **Wire per-job yolo permission mode** — `ChamberCopilotService` now starts a second `AcpConnection` against `chamber-copilot`'s `YOLO_ACP_ARGS` (`--acp --no-auto-update --yolo`, equivalent to `--allow-all-tools --allow-all-paths --allow-all-urls`). Minds can opt in per-call via `cli_delegate({ permission_mode: 'yolo' })`; jobs delegated under `'safe'` (the default) continue to flow through the approval-gated child worker. Yolo is wired best-effort: a yolo-start failure does NOT block safe startup — the service falls back to safe-only mode and surfaces `UnsupportedPermissionModeError` for any subsequent yolo request, which is the correct fail-closed behavior. The upstream `cli_delegate` tool description warns the model about the trade-off. (#258)

### Security

- **Per-mind isolation for the chamber-copilot tool surface** — `ChamberCopilotService` now hands each mind its own `cli_*` tool surface backed by a `MindScopedJobs` adapter. Returned job ids are namespaced as `${mindId}:${realJobId}`; cross-mind `cli_status` / `cli_respond` / `cli_approve` / `cli_cancel` / `cli_list` calls are rejected with the same `Unknown job_id` shape a non-existent id produces, so probing minds cannot enumerate other minds' jobs. `MindScopedJobs.delegate` and `MindScopedJobs.list` forward `permissionMode` straight through (the adapter never silently downgrades or upgrades the mode), and `status` snapshots preserve the `permissionMode` field so a mind can audit which posture each of its jobs is running under. Releasing a mind cancels every still-running job that mind owned. Operators should still note that `cli_approve` allows a mind to autonomously authorize tool execution in its own delegated child worker — the `ApprovalGate` does not interpose on those child-worker tool calls. Any change to this surface must run `COPILOT_REAL_CLI=1 npm run smoke:acp-desktop` before merge. (#258)

### Reliability

- **Eager prewarm + degraded-mode lifecycle for chamber-copilot** — `ChamberCopilotService` now exposes `prewarm()`, awaited at app boot when the flag is on, so both safe and yolo `AcpConnection`s are started before `MindManager.doLoadMind` calls `getSessionTools`. This guarantees the first mind in a fresh process sees the `cli_*` tools on its first session (previously they only appeared on the next session create). Both `prewarm()` and `activateMind` swallow connection-start failures so a missing or unspawnable copilot CLI does NOT take down the entire mind-loading pipeline; the service stays in a valid degraded state where `getToolsForMind` returns `[]` and the next activate retries the start. Releasing the last active mind stops both connections in sequence with per-connection error isolation so a failing yolo teardown cannot mask a failing safe teardown. (#258)

### Packaging

- **Ship the chamber-copilot ACP runtime with packaged builds** — A new `chamber-copilot-acp-runtime/` manifest folder pins `chamber-copilot` exactly (no caret) for the packaged installer, mirroring the `chamber-sharp-runtime/` and `chamber-copilot-runtime/` patterns. `scripts/prepare-acp-runtime.js` materializes it into `resources/acp-runtime/node_modules/` at package time via `npm ci --omit=dev`, validates the on-disk layout and the ESM `import('chamber-copilot')` smoke, and is wired into Forge's `prePackage` hook plus `extraResource`. `apps/desktop/src/main.ts` now resolves chamber-copilot through a `loadChamberCopilot()` helper (mirroring `loadSharp()` / `loadKeytar()`) so dev still resolves from the top-level `node_modules` while the packaged installer requires from `resources/acp-runtime/`. Fixes the "Cannot find module 'chamber-copilot'" error reported in Windows Sandbox. (#258)

### Testing

- **Add real-CLI smokes for the ACP runtime** — New `npm run smoke:acp` (gated on `COPILOT_REAL_CLI=1`) drives `chamber-copilot`'s `JobStore` through one delegate → session/update → idle cycle against the bundled CLI. New `npm run smoke:acp-desktop` boots the full Electron app with the flag enabled, drives `mind.add` via CDP, and verifies `ChamberCopilotService` actually spawns a child `copilot --acp` worker end-to-end. Both are excluded from the default `npm test`. (#258)

## v0.51.0 (2026-05-09)

### Agents

- **Make Chamber minds Chamber-aware by default** - Minds now receive concise Chamber operating context in their system message, including where to find Chamber docs and source guidance so they can help users use the app. Closes #256.

### Documentation

- **Put A2A at the center of Chamber docs** - The README now leads with Agent-to-Agent collaboration, and the user guide adds A2A concepts plus a built-in Chamber tool directory covering A2A, Canvas, cron, Lens, and marketplace CLI tools. (#256)

## v0.50.0 (2026-05-09)

### Profile

- **Import Microsoft profile details from Graph** — Settings can now import the signed-in user's display name, work details, location, and avatar through Windows brokered Microsoft Graph auth without reading another app's token cache.

### Renderer

- **Show profile avatars across agent surfaces** — Chat, chatroom, and sidebar views now render saved mind and user profile avatars consistently through shared profile hooks.

### Packaging

- **Ship the MSAL broker runtime with packaged builds** — The Windows package now materializes a pinned MSAL broker runtime alongside the Copilot and sharp runtimes so brokered Microsoft profile import can load its native dependencies after install.

## v0.49.13 (2026-05-09)

### Renderer

- **Make conversation history collapsible** — The right-side history panel now persists an expanded/collapsed preference, provides a narrow rail to recover chat width on smaller windows, shows distinct no-agent/loading/empty states, exposes row actions on keyboard focus, and uses an in-app delete confirmation dialog.
- **Keep fresh history summaries from being overwritten** — Conversation history updates now preserve newer local summaries when a stale list response arrives later, preventing recent renames or first-prompt titles from briefly disappearing.

### Testing

- **Update Genesis template smokes for the confirmation pane** — Lucy Genesis smoke tests now select the template card and confirm with **Choose this voice**, matching the current template-detail UI.

## v0.49.12 (2026-05-09)

### Renderer

- **Route pasted image drafts to the active agent** — `ChatInput` now refreshes controlled insertion callbacks when the active mind changes, so pasted image tokens are written to the current agent's compose draft instead of a stale draft setter from another agent. Fixes #221.

## v0.49.11 (2026-05-09)

### Testing

- **Unblock `npm run smoke:desktop` on Windows** — The Playwright `webServer` (`apps/server/dist/bin.mjs`) and the shared Electron test helper (`tests/e2e/electron/electronApp.ts`) were both eagerly importing `keytar` at module load. Windows holds an exclusive lock on a loaded `.node` native addon, so when `electron-forge start` next ran `@electron/rebuild` to swap `keytar.node` to Electron's ABI it failed with `EPERM: operation not permitted, unlink 'keytar.node'` and 0 of 22 desktop smoke tests could even start. Both call sites now lazy-load keytar (`bin.ts` exposes a `CredentialStore` proxy that calls `require('keytar')` only when a credential operation actually fires; `electronApp.ts` inlines the require inside `canAccessRepo`). Linux/macOS were unaffected (POSIX allows unlinking open files). (#250)

### Renderer

- **Fix three `MindSidebar` selector regressions from #244** — PR #244 intentionally added three `role="button"` accessibility controls per mind row (Edit profile / Open in window / Remove) nested inside the outer `<button>`. Eight desktop smoke tests using `getByRole('button', { name: /MindName/ })` then matched four elements and tripped Playwright's strict-mode guard. Switched the affected selectors in `monica-open-existing.spec.ts`, `lens-hotload.spec.ts`, and `desktop-navigation-popout.spec.ts` to `page.locator('button').filter({ hasText: /\bMindName\b/ })`, which restricts to real `<button>` elements (excluding the new `role="button"` `<span>`s) and uses word boundaries so `Inactive Lens Smoke Mind` cannot collide with `Active Lens Smoke Mind`. The `MindSidebar` accessibility additions are unchanged. (#250)
- **`ProfileMarkdownEditor` Save button stays in the viewport on small windows** — The new modal added in #244 wrapped its 420px-min textarea + header + footer in a `DialogContent` with no `max-height`, so on the default 800px Electron window the Save button rendered below the visible area and could not be reached by clicking, scrolling, or `scrollIntoViewIfNeeded` (the dialog is `position: fixed`, not part of the page scroll). `DialogContent` is now `flex max-h-[88vh] flex-col` and the textarea is `flex-1 min-h-[200px]`, matching the outer `AgentProfileModal` pattern: header/footer pinned, textarea scrolls internally. Save is now reachable in any reasonable window size. (#250)

## v0.49.10 (2026-05-08)

### Mind

- **Pass `.mcp.json` MCP servers from the mind folder into Copilot sessions** — `MindManager` now reads each mind's `<mindPath>/.mcp.json` and threads parsed `mcpServers` through `client.createSession`/`resumeSession`, working around an upstream `@github/copilot-sdk` bug where `enableConfigDiscovery: true` does not actually load workspace-scoped servers. Entries are validated against a Zod schema (stdio with `command` or HTTP/SSE with `url`); malformed JSON or schema-invalid entries warn-and-skip so a typo in one mind cannot break others. The `tools` field defaults to `["*"]` when omitted, matching the CLI's discovery behavior. (#199)

## v0.49.9 (2026-05-08)

### Auth

- **Per-request `AuthService.startLogin`** — `AuthService` no longer stores `onProgress` and abort state on the instance; `startLogin({ onProgress, signal })` accepts a per-attempt callback and an `AbortSignal`. Concurrent login attempts (browser + server, or two browser tabs) now have isolated progress streams and cancellation. The desktop IPC handler tracks an `AbortController` per in-flight `auth:startLogin` and aborts all of them on `auth:cancelLogin`. Removes `setProgressHandler` and `abort()` from the public surface. (#139)
- **Instance-scoped GitHub user agent** — Removed the static `AuthService.userAgent` global. `AuthService`, `GitHubRegistryClient`, and `GitHubReleaseAssetClient` each accept a `userAgent` constructor option (default `'Chamber'`). The desktop and server composition roots thread the same `Chamber/${version}` string through all three. Eliminates an order-dependent module-level mutation that could leak the wrong user agent between processes. (#139)

## v0.49.8 (2026-05-08)

### Server

- **Require capabilities at `ChamberCtx` construction** — Drop the `?` modifier from every route-backed capability on `ChamberCtx` so the loopback server fails at compile time when a deployment forgets to wire a feature, instead of silently returning a 503 at runtime. `createServerContext` now takes a `ServerContextInputs` (`Omit`-based) requiring all capabilities; only `token` and `allowedOrigins` are defaulted; `publish` stays optional as an observability hook. `bin.ts` builds `ChamberCtx` up front with real services backing `getConfig` / `listLensViews` / `listChamberTools`, and uses throwing `notImplemented(name)` stubs for surfaces with no implementation (`getGenesisStatus`, `saveAttachment`) so the contract refusal is explicit. A small `publishHolder` breaks the `sendChat` ↔ `serverControls.publish` cycle so the production context is constructed once and never mutated; the E2E fake-chat path is now `buildE2EFakeChatContext(productionContext)` returning a derived context. New `composition.test.ts` pins the contract with `@ts-expect-error` tripwires on `createServerContext` calls missing required capabilities. `handlers.test.ts` and `honoAdapter.test.ts` `makeContext` helpers use explicit `notConfigured(<name>)` throwing stubs for every required capability so tests fail loudly when wiring is wrong. Four `returns 503 when capability missing` tests are deleted (no longer representable at compile time); the `no shutdown handler` test is rewritten as `responds 200 even with a noop shutdown handler`. Closes #138. (#248)

## v0.49.7 (2026-05-08)

### IPC

- **Validate `chatroom:set-orchestration` payload with Zod** — The previously unvalidated `chatroom:set-orchestration` channel in `apps/desktop/src/main/ipc/chatroom.ts` now runs through `parseIpcArgs` (#63) with a `z.discriminatedUnion('mode', …)` schema that mirrors `OrchestrationMode` and the per-mode config interfaces from `packages/shared/src/chatroom-types.ts`. The five variants are: `concurrent`/`sequential` (config must be `undefined`); `group-chat` (optional strict `{ moderatorMindId: string, maxTurns: positive int, minRounds: non-negative int, maxSpeakerRepeats: positive int }`); `handoff` (optional strict `{ initialMindId?: string, maxHandoffHops: positive int }`); `magentic` (optional strict `{ managerMindId: string, maxSteps: positive int, allowedMindIds?: string[] }`). Per-mode config is `.optional()` because the renderer fires `setOrchestration(mode, undefined)` first when switching modes, then a second time with the auto-default config (see `apps/web/src/renderer/components/chatroom/OrchestrationPicker.tsx`). Failures surface as a `TypeError` whose message names the channel and lists every Zod issue path under `config.<field>`. 29 new tests cover the happy path for every mode (with and without config) plus the rejection lattice (unknown mode, non-string mode, unexpected config on `concurrent`/`sequential`, `null` config, wrong-type config, missing/empty/non-positive/non-integer fields, extra fields). Closes the last gap in the IPC-hardening series begun in #61/#62/#63. (#203)

## v0.49.6 (2026-05-08)

### IPC

- **Zod-backed IPC payload validation framework** — Added `parseIpcArgs(channel, schema, payload)` in `packages/shared/src/ipc-validation.ts`. The helper runs `schema.safeParse` and on failure throws a `TypeError` whose message names the channel and lists every Zod issue path. The plain-`TypeError`-with-string-message shape is dictated by Electron IPC: errors thrown from `ipcMain.handle` lose custom subclasses and own properties when crossing to the renderer, so the message string is the only durable diagnostic carrier across the boundary. Preload stays passthrough — schemas live alongside the IPC adapter that owns the channel. Migrated `chatroom:send` (refactored from manual `parseSendArgs`, preserving every existing invariant: non-empty message, optional model, roundId 1-128 chars; schema is a `z.object` so error paths name `message`/`model`/`roundId` instead of tuple indices) and `genesis:createFromTemplate` (previously unvalidated, now strict-object-typed: `templateId` non-empty, optional `marketplaceId`, `basePath` non-empty, no extra fields). 14 new genesis-payload-rejection tests parallel the existing `chatroom:send` validation tests. (#63)

## v0.49.5 (2026-05-08)

### IPC

- **Shared `ElectronAPI` type and typed `createIpcListener` channel** — Extracted the renderer-facing `ElectronAPI` interface and its `Window.electronAPI` global declaration into `packages/shared/src/electron-types.ts` per the original #62 specification, with the previous inline definition in `packages/shared/src/types.ts` replaced by a pointer comment to keep the two modules from circularly depending on each other. Tightened `createIpcListener<T>(ipcRenderer, channel, callback)` to require an `IpcChannel` (#61) instead of a free `string`, so misspelled or unknown channels now fail at compile time and the IPC channel constants become a real contract rather than decoration. Existing tests migrated to consume `IPC.*` constants. (#62)

## v0.49.4 (2026-05-08)

### IPC

- **Centralize IPC channel constants in `@chamber/shared`** — All IPC channel names are now declared in a single `IPC_CHANNELS` constant in `packages/shared/src/ipc-channels.ts`, with a typed `IpcChannel` union and the existing `createIpcListener` helper updated to consume them. Main-process IPC handlers in `apps/desktop/src/main/ipc/{auth,chat,chatroom,conversationHistory,genesis,lens,marketplace,mind,tools,updater}.ts` and the renderer's `preload.ts` channel registrations now reference the constants instead of magic strings. Adds 118 lines of unit coverage in `ipc-channels.test.ts` for naming convention, uniqueness, and cross-package consumer alignment. No behavior change. (#61)

## v0.49.3 (2026-05-08)

### Tests

- **Loopback HTTP and WebSocket route coverage** — Pin the server's loopback adapter behavior with 90 lines of unit tests for `isLoopbackHost`, `isAllowedOrigin`, and the constant-time `isAuthorized` Bearer-token check, plus 24 new HTTP and WebSocket scenarios for `honoAdapter` covering auth header enforcement, origin allowlist, route availability when capabilities are absent, shutdown, attachment upload, chat cancel, and WebSocket upgrade authorization. Pure characterization, no production code changes. (#142)

## v0.49.2 (2026-05-08)

### Tooling

- **Drop `--package-lock-only` from the ship workflow** — The ship skill no longer instructs maintainers to run `npm install --package-lock-only` after `npm version`. On local npm 11.6.x the flag silently strips top-level optional cross-platform binary entries (`@emnapi/core`, `@emnapi/runtime`, etc.) that the lockfile carries for non-current platforms, which then fails CI on npm 11.12.x with `Missing: <pkg> from lock file`. `npm version` already updates `package-lock.json`'s version field, so the second command was redundant for pure version bumps and harmful for everything else.

## v0.49.1 (2026-05-08)

### Packaging

- **Package Sharp as a native runtime** — The Windows installer now ships Sharp through a dedicated `sharp-runtime` resource prepared before Forge packaging, and the sandbox preflight verifies the Sharp package and native Windows binding are present before opening the installer. This prevents the installed app from failing at startup with `Cannot find module 'sharp'`.

## v0.49.0 (2026-05-08)

### Agent profiles

- **Edit local agent profiles in place** — Agent rows now open a desktop profile editor for the local `SOUL.md` and agent markdown files, with focused markdown editing, safe save validation, restart-to-apply, normalized avatar upload/cropping, and avatar display in the agent list. (#106)

### Runtime

- **Align packaged Copilot runtime smoke with the installed CLI** — The app and packaged runtime now pin `@github/copilot` to `1.0.44-2`, matching the CLI version reported by the runtime smoke during packaging.

## v0.48.0 (2026-05-08)

### Genesis

- **Scale voice selection for long persona lists** — The Genesis voice picker now uses a searchable master/detail layout with a scrollable persona rail, pinned custom "Someone else..." flow, editable research brief review step, and focused coverage for long lists and custom creation. The following role screen now keeps card text readable on the dark Genesis background. (#213)

### Website

- **Refresh the public landing page and README** — The website download CTA now resolves the latest Windows installer from GitHub releases, the README has been rewritten around a fresh app hero capture, and the app version is shown consistently in Settings and the loading screen.

## v0.47.0 (2026-05-08)

### Marketplace

- **Install internal CLI tools from GitHub release assets** — Marketplace `tools[]` entries can now use `install.type: "github-release-asset"` with platform/arch asset selectors and required SHA-256 checksums. Chamber downloads private release assets through the GitHub API using stored credentials, avoids forwarding tokens across release-download redirects, installs verified binaries into the Chamber tools bin directory, and prepends that directory to SDK subprocess PATH so advertised tools are executable. (#229)
- **Ship A365 tools through the internal marketplace** — The internal Genesis marketplace now declares A365 Teams, Mail, Calendar, Copilot, Planner, Whois, Word, Excel, and Sales tools from `agency-microsoft/a365-cli` release `v0.5.0`, preserving public/default marketplace behavior while enabling internal users to install prebuilt binaries without `gh`, Go, or a source checkout. (#229)

## v0.46.4 (2026-05-08)

### SDK

- **Expand SDK contract smoke coverage** - Chamber now validates live SDK model-list and deterministic tool execution event shapes through the same Zod-backed contract mappers used at runtime. Chatroom streaming also reuses the SDK event mapper boundary so contract drift surfaces as a clear streaming error instead of raw SDK field assumptions. (#194)

## v0.46.3 (2026-05-07)

### Updates

- **Refresh from the up-to-date updater icon** - The Activity Bar updater button now remains clickable when Chamber is already marked up to date, using the existing manual check path to refresh release state while still disabling duplicate actions during checking, downloading, and installing. (#226)

## v0.46.2 (2026-05-07)

### Chat

- **Let users control long-running chat turns** - Single-agent chat no longer has a Chamber-side wall-clock turn deadline; long-running agent work stays streaming until the SDK emits idle/error or the user presses Stop. The separate 30s `session.send()` wedge guard remains for stale-session recovery, and a real Electron smoke now clicks through the Stop flow. (#222)

## v0.46.1 (2026-05-07)

### Chat

- **Per-agent unsent compose drafts** — Compose textbox text is now keyed per active mind in app state (`composeDraftByMind`) instead of a single global React local-state value. Switching agents preserves the prior agent's unsent draft and restores the destination agent's draft; sending clears only the active agent's draft; empty drafts evict their key so the map stays compact across many minds; new conversation and mind removal both drop the affected mind's draft. `ChatInput` accepts optional `value` / `onValueChange` props for controlled mode (used by the single-agent chat panel) and falls back to its prior uncontrolled local-state behavior when omitted (chatroom panel unchanged). Drafts are renderer-only state and are not added to conversation history, persisted on disk, sent to the SDK, or mirrored across popout windows. (#221)
- **Stop falsely completing long-running single-agent turns** — `ChatService.streamTurn` no longer emits a success-shaped `done` event purely because the 5-minute idle fallback timer elapsed. The fallback now rejects with `TurnTimeoutError` and surfaces a typed `{ type: 'timeout', timeoutMs }` chat event, mirroring the chatroom precedent in `streamAgentTurn`. The renderer reducer already handles `timeout` by clearing `isStreaming` and rendering an "Agent timed out after `<s>`s" message, so the working/stop indicator stays accurate until the SDK reports real completion, failure, cancellation, or an explicit timeout. Server-mode `/api/chat/send` continues to await `sendMessage` cleanly because the timeout is handled inside `streamTurn` rather than thrown across the HTTP boundary, so long turns no longer disconnect the request or produce duplicate events. Regression coverage in `ChatService.test.ts` exercises the "send resolves but `session.idle` never fires" path. (#222)

## v0.46.0 (2026-05-07)

### Marketplace

- **CLI tools as a marketplace primitive** — Genesis-minds plugin manifests can now declare a `tools[]` array alongside `minds[]`. Each entry describes a globally-installable npm CLI (`{ install: { type: 'npm-global', package, version }, bin, help, preflight, agentInstructions }`). Chamber reads tools from every enrolled marketplace and persists installed tools in `~/.chamber/config.json` under `installedTools[]`. Foundation for the public-marketplace WorkIQ capability. (#218)
- **Auto-install on startup** — On app ready, `ToolsService.reconcile()` diffs marketplace `tools[]` against `config.installedTools[]` and runs `npm install -g <package>@<version>` for any new entry, then runs declared `preflight` commands (e.g. `workiq accept-eula`). Errors are logged per-tool and do not block other installs. Already-installed tools are not auto-updated. (#218)
- **Runtime tool context in the system message** — `IdentityLoader` accepts an `InstalledTool[]` provider and appends a `## Tools` section to every session's system message. Tool descriptions live in the marketplace manifest's `agentInstructions` field and are captured into the installed-tool record at install time, so model context is available offline. Mind directories are not modified. (#218)
- **Tools IPC + preload surface** — New `tools:list`, `tools:install`, `tools:uninstall` channels exposed via `window.electronAPI.tools.*`. Browser-mode shim returns descriptive "desktop-only" errors. (#218)
## v0.45.0 (2026-05-07)

### Chatroom

- **Toggle agents on/off in the participant bar** — Click an agent's pill at the top of the chatroom to disable it; click again to re-enable. Disabled agents grey out with a line-through name and are excluded from the participant snapshot taken at the start of each round. State persists in `chatroom.json`. The all-disabled / no-agents-loaded path emits a system message instead of a silent no-op, and orchestration prerequisite failures (group-chat moderator or magentic manager disabled) surface as a system message before the strategy runs. Cross-window state is kept in sync via a dedicated `chatroom:state-changed` IPC channel.

### Refactor

- **`SessionGroup` adapter for the chatroom** — Inserted an SDK-shaped `SessionGroup` seam between `CopilotSession` and `ChatroomService` so the chatroom no longer owns session lifecycle, permission-handler injection, stream-event wiring, stale-session retry, or orchestrator dispatch. New folder `packages/services/src/session-group/` with `SessionGroup`, `SessionGroupOrchestrator`, `stream-session.ts`, and the relocated `ConcurrentStrategy` / `SequentialStrategy` / `GroupChatStrategy` / `HandoffStrategy` / `MagenticStrategy` (under `session-group/orchestrators/`). `ChatroomService` is now a thin product-layer adapter over `SessionGroup` — transcript persistence, task-ledger persistence, mode/config selection, prompt building, and renderer event mapping. Behavior is preserved.

## v0.44.0 (2026-05-07)

### Chat

- **Harden conversation history lifecycle** - Resumed chats strip Chamber-injected datetime metadata, empty drafts are reused instead of duplicated, first prompts title persisted conversations, and model switching is serialized through the backend-confirmed session path. (#216)
- **Switch models in place via the SDK** - Model changes now call `session.setModel()` on the live SDK session, preserving conversation history. Removes the resume/recreate cycle that produced silent context loss after a mid-conversation model switch. (#216)
- **Bound stale-session recovery** - `ChatService` reattaches once via `recoverActiveConversationSession` and surfaces the error if the SDK still cannot find the session, instead of silently minting an empty replacement runtime. `MindManager.recoverActiveConversationSession` resumes by Chamber sessionId and falls back to `createSession({ sessionId })` under the same id. (#216)
- **Delete conversations from history** - History rows now expose a trash icon next to the rename pencil. Deleting an inactive conversation leaves the active chat untouched; deleting the active conversation hydrates the next most recent; deleting the last creates one empty draft. Confirmation only triggers for conversations with messages. (#216)
- **Expand lifecycle smoke coverage** - SDK smoke verifies repeated named-session resume and cross-model context preservation; Electron smokes cover empty-draft reuse, first-prompt title persistence, pending model-switch disabled states, model-switch context recall via a sentinel token, and the trash-delete flow. (#216)
- **Align packaged Copilot runtime** - Chamber now pins the packaged Copilot CLI runtime to `1.0.44-0`, matching the binary version validated by the packaging sandbox. (#216)

### Tooling

- **Add canvas extension scaffolding** - New `.github/extensions/canvas/` extension exposes a local canvas server and tools for rich visual output during agent sessions. (#216)

## v0.43.4 (2026-05-07)

### Chatroom

- **Surface agent turn timeouts as a distinguishable event** - `streamAgentTurn` now emits `{ type: 'timeout', timeoutMs }` when an agent turn rejects with `TurnTimeoutError`, instead of a generic `error` event. The renderer reducer renders an "Agent timed out after `<s>`s" message and clears the streaming/active-speaker state, so the chatroom no longer goes silent when the 5-minute send timer fires. (#53)

## v0.43.3 (2026-05-07)

### Performance

- **Use `Set` for round-id lookups in chatroom history** - `ChatroomService.getLastNRounds` now collects unique round ids with a `Set<string>` instead of `Array.includes`, replacing the O(n·r) inner loop with O(n+r) for chatrooms with deep history. (#54)

## v0.43.2 (2026-05-07)

### Chatroom

- **Align renderer and service roundIds** - The `chatroom:send` IPC handler now accepts an optional `roundId` and forwards it to `ChatroomService.broadcast`, which uses it for the persisted user message and emitted stream events. The renderer's optimistic `roundId` and the service-side identifier therefore agree, eliminating duplicate-round drift in the chatroom UI. (#50)

## v0.43.1 (2026-05-06)

### Security

- **Validate `chatroom:send` IPC arguments** - The `chatroom:send` handler now rejects non-string `message` and non-string-or-undefined `model` payloads with a `TypeError` before reaching `ChatroomService.broadcast`, closing the IPC contract against renderer-side type drift. (#51)

## v0.43.0 (2026-05-05)

### Chat

- **Add resumable conversation history** - Chamber now creates named Copilot SDK sessions per mind, shows them in a right-side history pane, supports metadata-only rename, and resumes selected sessions so follow-up prompts continue the prior conversation. (#55)

### Testing

- **Smoke conversation history flows** - Electron smoke coverage now drives Monica and Lucy through history-pane create, rename, per-mind isolation, and restart restore flows. (#55)

## v0.42.0 (2026-05-05)

### Cron

- **Fix cron job creation guidance** - `cron_create` now exposes a visible required payload shape, returns a specific missing-payload validation error, and has Electron smoke coverage for the create/list/run/history/remove lifecycle. (#210)

## v0.41.0 (2026-05-05)

### Lens

- **Add Canvas-backed Lens views** - Lens manifests can now declare `view: "canvas"` with an HTML source that renders inside Chamber through the Canvas server, preserving Activity Bar discovery while enabling richer Chamber-native UI.
- **Bridge Canvas Lens actions to minds** - Embedded Canvas Lens pages can call `window.canvas.sendAction(...)`, and Chamber routes token-gated actions back to the owning mind without exposing Electron or SDK access to generated HTML.
- **Upgrade the managed Lens skill** - Chamber now installs and upgrades the mind-local Lens skill to the Canvas Lens contract, clobbering exact old bundled skills while preserving locally edited managed or legacy-looking copies.

### SDK

- **Accept string tool arguments** - SDK tool execution events now tolerate object, JSON-string, and raw-string argument payloads, preventing contract mismatch failures for tools such as apply-patch.
- **Align the packaged Copilot runtime** - Chamber now pins `@github/copilot` to `1.0.42-0` so the packaged runtime smoke matches the CLI binary version bundled by npm.

### Testing

- **Smoke Canvas Lens rendering and actions** - Electron Lens smoke coverage now verifies Canvas Lens discovery, in-app rendering, and the iframe action bridge.

## v0.40.0 (2026-05-05)

### Chat

- **Persist model choices per agent** - Agent chat now stores each mind's selected model in its config and recreates the SDK session with that model so switching minds no longer shares one global picker value. (#46)
- **Inject local datetime context** - SDK prompts now include the current local datetime and timezone across chat, A2A tasks, chatroom orchestration, Genesis, and background prompt sends. (#32)

## v0.39.9 (2026-05-05)

### Desktop

- **Keep agent chat when popping out windows** - Desktop popout windows now synchronize chat state in memory with the main renderer so conversations continue when opened separately and return when the popout closes. (#39)
- **Open agent links externally** - Desktop windows now send external web and mail links to the OS browser instead of navigating Chamber away from the app. (#37)

## v0.39.8 (2026-05-05)

### Lens

- **Keep Lens refresh results across view switches** - In-flight Lens refreshes now survive renderer remounts so returning to a view applies the completed data instead of leaving stale content visible. (#38)

## v0.39.7 (2026-05-05)

### Chat

- **Preserve chatroom message types** - Chat event reduction now keeps extended chatroom message fields without casts when streaming events update messages. (#49)

## v0.39.6 (2026-05-05)

### Code Health

- **Deduplicate shared web contracts** - The web app now imports shared contracts from `@chamber/shared` instead of carrying local duplicate copies, keeping renderer, desktop, server, and package consumers on one contract surface.
- **Clarify validation scripts** - Smoke tests now use intent-based script names (`smoke:sdk`, `smoke:server-sdk`, `smoke:web`, `smoke:desktop`, and `smoke:packaged-runtime`), while unused watch/interactive aliases were removed and Playwright browser installation is exposed as a helper.
- **Tighten typed boundaries** - A2A payload predicates moved into shared contracts, Genesis IPC now requires explicit service dependencies, SDK model-cache clearing is isolated behind a compatibility helper, and server chat attachments validate against the wire DTO before dispatch.

### Lens

- **Validate Lens manifests before rendering** - View discovery now skips malformed or unsafe Lens manifests and rejects non-object view data instead of casting agent-authored JSON directly into app contracts.

## v0.39.5 (2026-05-05)

### SDK

- **Validate SDK chat event contracts** - Chat streaming now validates the SDK event fields Chamber consumes before mapping them into UI events, surfacing clear contract mismatch errors when SDK drift would otherwise produce broken chat output.

## v0.39.4 (2026-05-05)

### Chat

- **Disable hidden ask_user prompts** - Mind and Genesis SDK sessions no longer enable `ask_user` until Chamber has a UI flow to surface and answer those questions. (#58)

### Testing

- **Add live Monica chat smoke** - The existing-mind Electron smoke now sends a real Monica chat turn by default and verifies the live response path.

## v0.39.3 (2026-05-04)

### Genesis

- **Load marketplaces without the GitHub CLI** — Genesis marketplace reads now use the GitHub REST API directly, trying public access first and then stored Chamber GitHub credentials for private repositories. (#188)
- **Improve marketplace access guidance** — inaccessible marketplace errors now point users toward Chamber sign-in and repository permissions instead of `gh auth` account switching. (#188)

### Testing

- **Remove marketplace smoke dependency on `gh`** — Electron marketplace smoke tests now check repository access with the same REST API and stored credential path used by the app. (#188)

## v0.39.2 (2026-05-04)

### Genesis

- **Surface marketplace loading errors** — the Genesis voice screen now shows a clear error when marketplace templates fail to load instead of silently returning an empty list. (#86)
- **Fix dark-on-dark custom voice input** — added `text-foreground` to the custom voice text input so it's readable on dark themes.
- **Split voice input into Name + Backstory** — the custom voice flow now has separate fields for the mind name (used as the directory slug) and an optional backstory that enriches SOUL.md.
- **Fix custom role input** — selecting "Something else..." on the role screen now shows a text input instead of immediately submitting the literal string.

### Developer Experience

- **Add Logger utility** — new `Logger.create('Tag')` API with level gating (`debug`/`info`/`warn`/`error`/`silent`) controlled by `CHAMBER_LOG_LEVEL` env var. All ~50 `console.*` calls across the codebase now route through Logger. (#86)
- **Pre-start SDK version check** — `npm start` now validates that installed `@github/copilot` and `@github/copilot-sdk` versions match `package.json` pins before launching Electron.
- **Skip marketplace tests on auth mismatch** — e2e tests that need `agency-microsoft/genesis-minds` now skip with a clear message when the active `gh` account lacks access, instead of failing with a timeout.

### Testing

- **Expand Ernest e2e smoke** — the Genesis smoke test now exercises the backstory field and custom role input, covering all new Genesis inputs.

## v0.39.1 (2026-05-04)

### Packaging

- **Remove legacy Forge macOS signing wiring** — macOS signing now has a single electron-builder path through `CHAMBER_MACOS_SIGNING`, keeping the current Windows release workflow independent of future Apple certificate setup. (#179)

## v0.39.0 (2026-05-04)

### macOS

- **Add macOS build support** — Chamber can now build macOS dmg/zip artifacts with platform-aware builder resources, optional signing/notarization settings, a macOS tray fallback icon path, and a draggable hidden-inset titlebar strip. (#177)
- **Refresh the packaged Copilot CLI pin** — the development and committed desktop runtimes now pin `@github/copilot@1.0.41-1` so package smoke checks match the CLI binary shipped by the npm package.

### Genesis

- **Keep generated mind paths safe** — Genesis now shortens long custom voice-derived directory names and refuses to create a mind over an existing target directory. (#177)

### Lens

- **Let wide Lens views use the full pane** — table, status-board, and timeline views now avoid the prose-width cap, and tables can scroll horizontally when columns overflow. (#177)

## v0.38.2 (2026-05-04)

### Lens

- **Scope hot-loaded Lens views to the active mind** — Lens create/delete watcher events now publish the changed mind ID and the renderer ignores inactive-mind updates, preventing duplicate activity-bar entries when multiple minds expose views with the same ID.

## v0.38.1 (2026-05-01)

### Mind registry

- **Preserve minds after restore failures** — Chamber now keeps configured mind records when a startup restore attempt fails, so a transient runtime, filesystem, or validation error cannot silently prune the registry on shutdown. (#180)

## v0.38.0 (2026-04-30)

### Genesis marketplace

- **Enroll marketplaces from install links** — Chamber now registers the `chamber://install?registry=...` protocol, handles cold-start and already-running app links, and documents README badge/fallback URLs for one-click Genesis marketplace enrollment. (#172)
- **Guide private marketplace setup** — marketplace access failures now identify the active GitHub CLI account and explain how to switch or log in, while GitHub-safe README badges can route through the hosted `install.html` interstitial before opening Chamber. (#172)

### Packaging

- **Refresh the Copilot CLI pin** — the development and committed desktop runtimes now pin `@github/copilot@1.0.40-2` so Electron smoke and package smoke checks match the CLI binary shipped by the runtime package.

## v0.37.0 (2026-04-30)

### Genesis marketplace

- **Manage marketplaces in Settings** — Settings now lists followed Genesis marketplaces and lets users add, enable, refresh, and remove non-default marketplace sources from the desktop UI. (#171)

## v0.36.0 (2026-04-30)

### Genesis marketplace

- **Add first-run marketplace enrollment** — the Genesis landing screen now includes an Add Marketplace path backed by desktop IPC and validation so users can enroll internal Genesis marketplace repositories by URL without editing config files. (#170)

## v0.35.0 (2026-04-30)

### Genesis marketplace

- **Aggregate followed Genesis marketplaces** — Chamber now persists the default public Genesis marketplace in app config and discovers templates across enabled marketplace registries while preserving accessible sources when a private/internal registry cannot be read. (#169)

## v0.34.2 (2026-04-29)

### Genesis

- **Improve voice card readability** — bump card text sizes and use explicit foreground color with semibold weight on mind names so they stand out against the dark background.

## v0.34.1 (2026-04-28)

### Packaging

- **Share the packaged renderer path** — Forge, Vite, and the Windows Sandbox preflight now use one shared renderer path constant so packaged renderer checks cannot drift from the configured renderer output. (#146)

## v0.34.0 (2026-04-28)

### Desktop updates

- **Migrate Windows releases to electron-builder updates** — Windows packaging now produces NSIS updater artifacts with `electron-updater` support, preserves Azure Trusted Signing inside the release pipeline, cleans up legacy Squirrel installs on first NSIS launch, and includes a local auto-update click-through runbook.
- **Refresh the packaged Copilot CLI pin** — the committed desktop runtime now pins `@github/copilot@1.0.39` so packaged runtime smoke checks match the CLI binary shipped by the npm package.

## v0.33.2 (2026-04-28)

### Chat

- **Show A2A senders in recipient chats** — inbound agent-to-agent messages now render with the sending agent's name and avatar color instead of appearing as `You`, with Electron smoke coverage for Ernest messaging Monica.

### Startup

- **Restore the minimal app shell** — the web/Electron entry point now starts from an empty dark mount node so the marketing landing page no longer flashes before React loads.

## v0.33.1 (2026-04-28)

### Testing

- **Playwright chatroom + chat-input UI smokes** — new `tests/e2e/web/chat-input.spec.ts` drives the real `Message your agent…` textarea + Enter-key path through the fake-chat loopback, and `tests/e2e/web/chatroom-ui.spec.ts` covers the chatroom view + `OrchestrationPicker` mode switching across all five strategies with exclusive-aria-pressed and active-description-text assertions.
- **`CHAMBER_E2E_FAKE_MINDS` server-side seeding** — `apps/server/src/bin.ts` accepts a comma-separated list of fake mind paths in fake-chat mode and pre-seeds them at boot. Specs no longer need to call `mind.add` + `page.reload()` to get past the first-run gate.
- **First-run friction removed** — added `scripts/install-playwright-browsers.js` (idempotent Chromium installer) and wired it into every `test:ui:*` script so contributors no longer hit the "Looks like Playwright was just installed" red box on first run.
- **Live Genesis spec is opt-in** — `tests/e2e/electron/genesis-ernest-chat.spec.ts` now skips unless `CHAMBER_E2E_LIVE_GENESIS=1` is set, so default `test:ui:e2e` runs are deterministic for any contributor (no Copilot login required).

### Docs

- **Change Discipline + E2E test docs** — added a `Change Discipline` section to `.github/copilot-instructions.md` (surgical edits, no speculative scope, define-done-before-coding) and a new `End-to-end tests (Playwright)` section to `CONTRIBUTING.md` documenting the `test:ui:*` scripts and the `CHAMBER_E2E_*` env vars.

## v0.33.0 (2026-04-27)

### Genesis marketplace templates

- **Install predefined Genesis minds from templates** — Genesis onboarding can now discover marketplace-backed mind templates, install predefined minds such as Lucy without live SDK generation, and surface hard failures instead of silently falling back to generated creation. (#162)

## v0.32.4 (2026-04-27)

### Browser mode

- **Surface unsupported write actions** — browser fallback APIs now throw explicit `Not available in browser mode` errors for unsupported write operations instead of silently resolving no-ops, while subscription handlers still return no-op unsubscribe functions. (#143)

## v0.32.3 (2026-04-27)

### Chat input

- **Keep emoji shortcode suggestions visible** — shortcode autocomplete now flips above the caret near the bottom edge and clamps within the viewport so suggestions are not clipped. (#157)

## v0.32.2 (2026-04-27)

### Release packaging

- **Recover Copilot runtime promotion on Windows** — release packaging now falls back to copying the staged Copilot runtime when Windows refuses the final directory rename with `EPERM`, preventing the Forge prePackage hook from failing on release runners.

## v0.32.1 (2026-04-27)

### Windows packaging

- **Restore Start Menu icon wiring** — Windows packages now embed a Chamber `.ico` asset in the app executable and pass the same icon to the Squirrel setup flow so Start Menu shortcuts have the expected app icon. (#35)

## v0.32.0 (2026-04-27)

### Browser loopback chat

- **Route browser chat through real services** — browser mode can now add an existing local mind path through the loopback server and send chat turns through the same `MindManager` and `ChatService` path used by the desktop shell.
- **Stream browser chat events** — the loopback WebSocket now supports browser token authentication, per-message subscriptions, and chat event fanout so renderer state updates from server-side SDK sessions.
- **Expand browser client contracts** — `@chamber/client` and wire contracts now cover mind loading, chat send, new conversations, and model listing for the browser API adapter.

## v0.31.5 (2026-04-27)

### Agent lifecycle

- **Prevent duplicate mind sessions** — loading the same mind folder through equivalent path spellings now returns the existing mind instead of creating another SDK client/session that can collide on extension tool names.
- **Select reopened minds deterministically** — Open Existing and agent directory selection now activate the mind returned by the load call instead of assuming the last item in the refreshed list is the intended agent.

## v0.31.4 (2026-04-27)

### Genesis lifecycle

- **Wait for mind readiness after genesis** — Chamber now keeps the genesis gate active until the created mind is loaded and selected, preventing the first chat view from opening before chat state is ready.
- **Load working memory into first context** — agent identity loading now includes existing `.working-memory/memory.md`, `rules.md`, and `log.md` content in the system message so the first turn after genesis has the expected memory context.

## v0.31.3 (2026-04-27)

### Lens

- **Hot-load Lens create and delete events** — Lens view discovery now debounces watcher events, rescans on view creation and folder removal, and clears pending rescans when watchers stop so the activity bar stays in sync without restarting Chamber. (#29)

## v0.31.2 (2026-04-27)

### Server

- **Make the privileged loopback channel real** — privileged credential requests now validate protocol payloads strictly and execute supported credential operations through the OS credential store instead of returning fake success with echoed request data. (#140)

## v0.31.1 (2026-04-26)

### Repo hygiene

- **Ignore generated workspace artifacts** — workspace build outputs under `apps/server/dist/` and `apps/web/dist/` are no longer tracked, and a regression test keeps those generated files ignored. (#141)

## v0.31.0 (2026-04-26)

### Web/server transport migration

- **Add workspace app boundaries** — Chamber now has `apps/web`, `apps/server`, and `apps/desktop` workspaces plus `packages/shared`, `packages/wire-contracts`, `packages/client`, and `packages/services` foundations so the React UI can run in a browser or inside Electron.
- **Introduce loopback server delivery** — added a Hono-backed local server with authenticated HTTP routes, WebSocket upgrade checks, a versioned privileged protocol scaffold, and server smoke coverage.
- **Preserve loopback POST and stream semantics** — the local server now uses Hono's Node adapter so request bodies reach POST handlers and browser auth receives device-flow progress before login completes.
- **Thin the desktop shell** — Forge now targets the desktop workspace entry and a slim preload bridge while the renderer can fall back to the browser-safe client path.
- **Fail closed on unimplemented chatroom approvals** — side-effect tool requests in chatroom mode now get an explicit approval-UI-not-wired denial instead of silently falling through the default approval gate.
- **Harden service seams** — service-layer Electron imports were replaced with ports for app paths, credentials, notifications, external opening, runtime layout, time, randomness, IDs, and session publishing.
- **Add UI automation coverage** — Playwright now smoke-tests both the browser UI and Electron shell, and the Chamber UI tester agent documents the workflow for future web and desktop validation. Follow-up browser parity work is tracked in #135.

## v0.29.1 (2026-04-25)

### Packaged Copilot runtime

- **Ship the runtime in the box** — packaged Chamber no longer runs `npm install` into `%APPDATA%\chamber\copilot` on first launch. It now ships a pinned `@github/copilot-sdk` + `@github/copilot` runtime under `resources\copilot-runtime`, so opening a mind works offline and cannot drift against a stale user cache.
- **Pin SDK + CLI together** — Chamber now treats the SDK/CLI pair as a committed runtime contract in `chamber-copilot-runtime\package.json` + `package-lock.json`, then materializes the packaged runtime with `npm ci` at package time.
- **Use the native CLI directly** — `CopilotClientFactory` now passes the platform `copilot.exe` binary directly as `cliPath`, removing the bundled-Node/npm-loader trampoline path and matching the real packaged runtime more closely in smoke coverage.

## v0.29.0 (2026-04-25)

### SDK 0.3.0 permission compatibility

- **Fix tool calls denied server-side** — `@github/copilot-sdk` 0.3.0 enforces server-side permission rules (path verification, tool gates, URL gates) that fire **before** chamber's `onPermissionRequest` handler. With the previous defaults, agent reads/shell calls were silently denied (e.g. Miss Moneypenny couldn't open her own `.working-memory/`). Chamber now passes `--allow-all-tools --allow-all-paths --allow-all-urls` to the underlying CLI so all permission decisions defer to the SDK handler, where chamber's auto-approve + chatroom `ApprovalGate` already enforce the security boundary.
- **CopilotClientFactory** — explicit cliArgs documented inline; covered by a new unit test asserting all three flags are present.

## v0.28.0 (2026-04-24)

### Floating panel UI

- **Rounded, spaced panels** — activity bar, agents sidebar, and main content now float on the window with rounded corners and a gap between them, instead of sharing edges.
- **Subtle navy tint** — background, card, border, and interactive surface tokens share a single navy hue so panels and controls feel cohesive instead of clashing with the chat input.

### Chat input

- **Grows to 13 lines, then scrolls** — the textarea resizes based on its own computed line-height and keeps the caret visible once capped, fixing a bug where `flex-1` pinned the textarea to minimum height and scrolled immediately.
- **Paste images** — pasting an image into the chat input inserts an inline `[📷 name]` placeholder at the caret and attaches the image for send. Attachments are forwarded to the SDK as blob attachments (base64 + MIME) and render inline in the user's message bubble in the transcript. Removing the `[📷 ...]` token from the text drops its attachment.

## v0.27.0 (2026-04-23)

### Built-in canvas

- **CanvasService** — Chamber now ships canvas as a first-class main-process service instead of a per-mind `.github/extensions/canvas` adapter.
- **Shared localhost canvas server** — one built-in HTTP server serves canvases for all loaded minds with mind-scoped URLs and server-sent-event live reload.
- **Per-mind canvas content** — rendered files now live in `<mindPath>/.chamber/canvas/` instead of under `.github/extensions/canvas/data/content/`.
- **Canvas tools restored** — minds once again get `canvas_show`, `canvas_update`, `canvas_close`, and `canvas_list`.
- **Default browser launch** — canvas pages now open via Electron in the user's default browser instead of hardcoding Microsoft Edge.

### Runtime architecture

- **CanvasServer** — pure Node HTTP server with bridge-script injection, SSE reload, and browser action POST back-channel.
- **ChamberToolProvider reuse** — canvas now plugs into the same provider seam used by cron and A2A instead of reviving the deleted extension loader.

## v0.26.0 (2026-04-23)

### Built-in cron

- **CronService** — Chamber now ships cron as a first-class main-process service instead of a per-mind `.github/extensions/cron` adapter.
- **Per-mind cron storage** — scheduled jobs live in `<mindPath>/.chamber/cron.json` with durable run history in `<mindPath>/.chamber/cron-runs.json`.
- **Job types** — cron supports prompt, process (`execFile`), webhook, and notification jobs.
- **Prompt jobs via TaskManager** — scheduled prompt runs execute in isolated task sessions and never interfere with the user’s live chat session.
- **Cron tools** — minds now get `cron_create`, `cron_list`, `cron_remove`, `cron_enable`, `cron_disable`, `cron_run_now`, and `cron_history`.

### Runtime architecture

- **ChamberToolProvider** — replaced the old extension-loading seam with provider-based tool injection.
- **A2aToolProvider** — A2A tools now participate through the same provider abstraction used by built-in services.
- **Windows tray persistence** — closing the window hides Chamber to the tray; explicit Quit shuts the app down.
- **Single-instance lock** — launching Chamber a second time focuses the running instance instead of creating a duplicate process.

### Genesis

- **No `.github/extensions/` scaffold** — new minds no longer create the extensions folder locally.
- **Skills-only bootstrap** — genesis bootstrap installs remote skills without pulling template extensions back onto disk.

### Breaking changes

- **Removed extension loader runtime** — `src/main/services/extensions/` has been deleted.
- **Canvas and IDEA adapters removed** — follow-up work will re-internalize them as Chamber-native services.

## v0.25.0 (2026-04-18)

### Chatroom: orchestration strategies

- **5 orchestration modes** — Concurrent (parallel fan-out), Sequential (round-robin with accumulated context), GroupChat (moderator-directed with speaker selection), Handoff (agent-to-agent delegation with transcript), Magentic (manager-driven task ledger with step budget).
- **OrchestrationStrategy interface** — pluggable strategy pattern with `OrchestrationContext` adapter; adding a new mode requires zero changes to ChatroomService.
- **OrchestrationPicker UI** — mode selector with per-mode config dialogs (moderator, initial agent, manager, max hops/steps).
- **Shared stream-agent infrastructure** — extracted duplicated SDK event wiring, stale session retry, and send timeout into `stream-agent.ts`; shared XML/JSON helpers in `shared.ts`.
- **Approval gate** — configurable tool execution review gate for orchestrated sessions.
- **Structured observability** — event emission with parameter redaction for orchestration audit trails.

### Bug fixes

- **Session idle race condition** — `session.idle` and `session.error` listeners now register BEFORE `session.send()` in both ChatService and all 5 strategies, preventing missed events that caused 5-minute hangs.
- **Send timeout guard** — 30-second timeout on `session.send()` itself; if the call hangs (dead WebSocket), throws a stale session error triggering retry with a fresh session.
- **TypingIndicator alignment** — chatroom typing indicator now left-aligns with message content instead of centering.

## v0.24.0 (2026-04-17)

### Model picker

- **Fresh model list on every mind connect/switch** — removed the `useRef` one-shot cache in `useAppSubscriptions` that prevented new SDK models from appearing until restart. Models now fetch fresh whenever the active mind changes. (#97)

### Repo hygiene

- **Backlog migrated to GitHub Issues** — removed `backlog.md`; all 62 open items filed as issues #29–#90 with `now` / `next` / `later` priority labels. Open work is tracked on the issue tracker from here on.
- **Design notes promoted to discussion issue** — removed `docs/design-notes.md`; contents captured in #28 for inline commentary.

### SDK

- **CopilotClient runs with the mind folder as `cwd`** — `CopilotClientFactory.createClient` now forwards `mindPath` as the CLI process `cwd`. Previously the CLI inherited Electron's launch directory (often `C:\Windows\System32` when launched from Start Menu), so mind-local config like `.mcp.json`, `.copilot/`, and `AGENTS.md` was never discovered. Each mind now spawns its CLI inside its own folder.

## v0.23.0 (2026-04-16)

### Chat: turn-level work log

- **WorkGroup panel** — replaced the stack of per-tool and per-reasoning `Collapsible` cards with a single compact panel per turn. Each tool call and reasoning step is now a one-line entry (icon + heading + preview); click to expand the full output or reasoning body inline.
- **Streaming auto-expand** — the running tool in the active group auto-expands so its output is visible while it streams, and collapses back to a one-liner when done.
- **Truncation** — groups with more than 6 entries collapse the older ones behind a "Show N more" control.
- **Safer previews** — tool previews now pull only from an allowlisted set of argument keys (`command`, `path`, `file`, `query`, etc.) so sensitive-looking args like `token` / `apiKey` / `password` can't leak into the collapsed row.
- **Design notes** — rationale + locked architectural decisions captured in `docs/design-notes.md`.

## v0.22.0 (2026-04-16)

### Chat markdown rendering
- **Typography plugin** — registered `@tailwindcss/typography` via Tailwind v4 `@plugin` directive so `prose` classes now actually style headings, lists, tables, and blockquotes in chat messages.
- **Syntax highlighting** — added `rehype-highlight` with a `github-dark` theme for fenced code blocks.
- **External links** — markdown links now open in a new window with `rel=noopener noreferrer`.
- **Refined overrides** — cleaned up `.prose` CSS for inline vs block code chips and GFM tables.

## v0.21.0 (2026-04-16)

### Multi-account GitHub auth
- **Account selection** - Settings now lists all stored GitHub accounts, keeps the active account selected, and lets you add another account from the same picker.
- **Active login persistence** - Chamber now persists `activeLogin` in config so auth status resolves the intended credential instead of whichever one keytar returns first.
- **Full auth reload on switch** - Switching accounts reloads every mind so Copilot clients, chatroom sessions, and task sessions all restart with fresh auth state.
- **Targeted logout** - Logging out removes only the active credential and returns the app to the signed-out flow without auto-switching to another stored account.

## v0.20.0 (2026-04-15)

### Settings view and logout
- **Settings navigation** — added a bottom-pinned gear icon in the ActivityBar that opens a dedicated Settings view.
- **Account section** — Settings now shows the current GitHub login and a logout action in the app UI.
- **Logout flow** — logging out deletes the stored keytar credential, broadcasts the event to all windows, and returns AuthGate to the sign-in screen.

## v0.19.7 (2026-04-13)

### Lens discovery fix
- **Late-created lens folders** — Chamber now discovers lens views created after a mind was already loaded instead of requiring a manual reload.

## v0.19.6 (2026-04-13)

### Zero Lint / CI Green
- **ESLint clean** — resolved all errors and warnings across the codebase
- **CI `validate` job** — new workflow step runs `npm run lint` on every push and PR
- **Pre-commit hook** — lint check runs before each commit via Husky + lint-staged
- **Dependency updates** — eslint-plugin-import, TypeScript ESLint tooling refreshed

## v0.19.5 (2026-04-13)

### Final Message Drop Fix
- **Reducer `message_final` handler** — was checking `blocks.some(b => b.type === 'text')` which silently dropped final message content when any earlier text block existed. Now checks `b.sdkMessageId === event.sdkMessageId` so the agent's final response after tool calls is correctly added as a new TextBlock.

## v0.19.4 (2026-04-13)

### Session Timeout Recovery
- **Stale session detection** — `isStaleSessionError()` utility detects "Session not found" errors from harvested CLI sessions
- **ChatService retry** — catches stale session on `send()`, emits `reconnecting` event, recreates session via `MindManager.recreateSession()`, retries once
- **ChatroomService retry** — evicts stale session from cache, creates fresh session, retries broadcast once
- **TaskManager retry** — catches stale session on A2A task sends, creates fresh task session, rebinds listeners, retries once
- **MindManager** — `recreateSession()` now returns the new `CopilotSession` for caller use
- **`reconnecting` ChatEvent** — new event type for UI indicators during session recovery

## v0.19.0 (2026-04-13)

### Chatroom (Phase 5)
- **ChatroomService** — broadcast user messages to all loaded agents in parallel with isolated per-mind chatroom sessions
- **Round-based echo prevention** — agents respond to user messages only; previous round context injected as escaped XML `<chatroom-history>`
- **Session isolation** — chatroom sessions are separate from individual chat sessions (no context bleed)
- **Mid-round sends** — user can send while agents are still responding; incomplete responses cancelled automatically
- **Incremental persistence** — chatroom transcript saved to `~/.chamber/chatroom.json` with atomic writes (500 message cap)
- **ChatroomPanel UI** — single timeline with sender badges, colored agent avatars, participant bar with status indicators
- **Multi-agent streaming** — multiple agents stream simultaneously with independent progress tracking
- **Per-agent error isolation** — one agent failing doesn't affect others
- **ActivityBar navigation** — chatroom icon (Users) between Chat and Lens views

## v0.18.1 (2026-04-13)

### Structural Cleanup (Uncle Bob Review)
- **Deleted orphaned `agent.ts` IPC** — dead module that would crash on import (duplicate handlers)
- **Deleted `SdkLoader.ts` singleton** — superseded by `CopilotClientFactory`; migrated `MindScaffold` to use injected factory
- **Created `mind/` barrel export** — consistent with all other service directories
- **Fixed dependency direction** — A2A protocol types now defined in `shared/`, not re-exported from `main/`
- **Completed `agent:` namespace migration** — removed deprecated API, preload bindings, backward-compat IPC handlers; `useAgentStatus` hook now uses `mind:` namespace exclusively
- **Cleaned up `main.ts` composition root** — replaced `_restorePromise` as-any hack with proper `awaitRestore()` method; extracted event wiring into `wireLifecycleEvents()`
- **Moved `index.css`** to `src/renderer/` (renderer-only concern)
- **Removed duplicate `makeMessage`** helper from `store.test.ts`

## v0.18.0 (2026-04-13)

### A2A Tasks (Phase 4)
- **TaskManager service** — full A2A 8-state lifecycle (submitted → working → completed/failed/canceled/input-required/rejected/auth-required)
- **Isolated sessions per task** — `MindManager.createTaskSession()` creates independent conversation contexts
- **4 new agent tools** — `a2a_send_task`, `a2a_get_task`, `a2a_list_tasks`, `a2a_cancel_task`
- **Artifact extraction** — agent responses become A2A Artifacts with artifactId, name, parts[]
- **input-required flow** — SDK `onUserInputRequest` callback maps to A2A interrupted state, `resumeTask()` resumes
- **TaskPanel UI** — tasks grouped by agent, status badges, expand for artifacts, cancel button
- **Real-time IPC events** — `task:status-update` and `task:artifact-update` streamed to renderer
- **A2A conformity** — ListTasksResponse wrapper, required contextId, Artifact.extensions, AgentCard.iconUrl, AgentExtension type, historyLength semantics

### Fixes
- **Boot screen version** — pulls from package.json dynamically (was hardcoded 0.15.0)
- **TaskSessionFactory interface** — TaskManager depends on interface, not MindManager (DIP)
- **Typed IPC boundary** — ElectronAPI.a2a methods use real types, not `any`
- **Defensive copies** — all public TaskManager methods return snapshots
- **Task eviction** — MAX_COMPLETED_TASKS=100 prevents unbounded memory growth
- **Terminal-state guards** — assistant.message events don't mutate canceled tasks
- **Response accumulation** — multiple assistant messages accumulate in artifact text

## v0.17.0 (2026-04-13)

### A2A Messages (Phase 3)
- **MessageRouter** — in-process A2A routing mirroring SendMessage RPC
- **AgentCardRegistry** — A2A-conformant AgentCards from mind metadata
- **TurnQueue** — per-mind turn serialization preventing session.send() races
- **2 agent tools** — `a2a_send_message` (fire-and-forget), `a2a_list_agents`
- **Sender attribution** — SenderBadge component shows "↪ from Agent A" on incoming messages
- **XML prompt serialization** — structured envelope for model injection
- **Hop-count loop protection** — per-contextId tracking, MAX_HOPS=5
- **Per-mind streaming state** — A2A on one mind doesn't block another's UI

## v0.16.0 (2026-04-12)

### Agent Windowing (Phase 2)
- **Pop-out windows** — right-click agent in sidebar → "Open in New Window"
- **Window management** — `MindManager.attachWindow()`/`detachWindow()`
- **Independent renderers** — each window gets its own chat panel
- **Closing popout** doesn't unload the mind

## v0.15.0 (2026-04-12)

### Multi-Mind Runtime (Phase 1)
- **MindManager** — aggregate root with `Map<mindId, InternalMindContext>`
- **CopilotClientFactory** — instance-based, one CopilotClient per mind
- **IdentityLoader** — SOUL.md parsing for agent identity
- **ExtensionLoader** — canvas, cron, IDEA adapters per mind
- **ConfigService** — persists `openMinds[]`, `activeMindId`, migration from v1
- **Sidebar** — agent list, click to switch, add/remove minds
- **IPC adapters** — thin one-liner handlers for chat, mind, lens, genesis, auth

## v0.14.0 (2026-04-10)

- **Packaging** — `npm run package` produces installable Electron app
- **Bundled Node runtime** — `scripts/prepare-node-runtime.js` for SDK in packaged builds

## v0.13.0 (2026-04-09)

### Auth & Credential Fixes
- **Fix OAuth client ID** — switch from deprecated `Iv1.b507a08c87ecfe98` to current CLI client ID `Ov23ctDVkRmgkPke0Mmm` with correct scopes (`read:user,read:org,repo,gist`)
- **Fix UTF-16/UTF-8 credential encoding** — cmdkey stores blobs as UTF-16LE but the CLI reads via keytar (UTF-8). Now uses Win32 `CredWriteW` directly with UTF-8 encoding via a compiled helper
- **Fix PowerShell Add-Type timeout** — replaced slow JIT compilation with a precompiled `CredWrite.exe` via `csc.exe` (cached on first run)

### Agent Identity & Personality
- **Agent identity injection** — ChatService loads SOUL.md + `.github/agents/*.agent.md` and injects them into the session via `systemMessage` customize mode
- **Replace SDK identity section** — agent's SOUL replaces the default "You are GitHub Copilot CLI" identity while preserving all tool instructions, safety, and environment context
- **Remove SDK tone override** — the "100 words or less" tone section was suppressing agent personality; removed so SOUL.md's Vibe section controls voice

### Genesis & Boot
- **Surface genesis errors** — boot screen now shows red error text with actionable hint instead of spinning forever on failure
- **Fix BootScreen crash** — React strict mode double-fired useEffect corrupting interval index; fixed with optional chaining and value capture

## v0.12.0 (2026-04-09)

- **Auth gate** — GitHub device flow login, Windows Credential Manager storage

## v0.11.0 (2026-04-09)

- **The Genesis Moment** — full cinematic new-mind onboarding
- Void → Voice → Role → Boot → First Words
- Agent writes its own SOUL.md, personality, and identity
- MindScaffold: deterministic folders + agent-generated soul
- Landing screen: ✨ New Agent / 📂 Open Existing
- "Change your mind…" returns to landing
- Default mind path: `~/agents/{slug}/`

## v0.10.2 (2026-04-09)

- Fix logo icons (B/G → C)
- Remove "Genesis Chamber" branding — just Chamber

## v0.10.1 (2026-04-09)

- **Auto-seed Newspaper** alongside Hello World on mind connect

## v0.10.0 (2026-04-09)

- **Renamed to Chamber**
- Agent name from SOUL.md shown in chat
- Config dir now `~/.chamber/`

## v0.8.1 (2026-04-09)

- **Four new Lens view types:** detail, status-board, timeline, editor
- Agent now has 7 view components to choose from when creating Lens views

## v0.8.0 (2026-04-09)

- **Lens skill auto-installs** into minds on connect — agent learns to create views
- **Write-back:** action input bar on every view sends instructions to the agent
- Agent can now modify view data through natural language

## v0.7.0 (2026-04-09)

- **Briefing view type:** card grid with emoji icons and large number display
- **Table view type:** data table with headers from schema
- Newspaper view as a prompt-driven briefing

## v0.6.0 (2026-04-09)

- **Lens declarative view framework** — drop a `view.json` in `.github/lens/`, get a UI view
- Dynamic activity bar populated from discovered views
- Prompt-driven views: click Refresh → agent gathers data → view renders
- File watcher for hot discovery
- Hello World view auto-seeded on mind connect

## v0.5.0 (2026-04-09)

- **Activity bar + view switching** — VS Code-style three-column layout
- Contextual side panels per view
- App-level subscriptions survive view switches

## v0.4.0 (2026-04-09)

- **Model picker** inside chat input (shadcn Select)
- Models fetched from Copilot SDK, persisted in localStorage

## v0.3.0 (2026-04-08)

- Rich streaming UI with content blocks (text, tool calls, reasoning)
- shadcn/ui component library (Badge, Collapsible, ScrollArea)

## v0.2.0 (2026-04-08)

- Extension system: canvas, cron, IDEA adapters
- SDK auto-install on packaged builds
- CI/release GitHub Actions workflows

## v0.1.0 (2026-04-08)

- Initial release — desktop chat interface for Genesis minds
- Streaming chat with Copilot SDK
- Mind directory picker with validation
