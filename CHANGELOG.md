# Changelog

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
- **Refresh the packaged Copilot CLI pin** — the development and committed desktop runtimes now pin `@github/copilot@1.0.41-0` so package smoke checks match the CLI binary shipped by the npm package.

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
