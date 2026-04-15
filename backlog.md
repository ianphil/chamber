# Chamber — Backlog

## Now

- [x] **🔴 Session timeout recovery** `bug` `p0` — idle session gives "Session not found" when CLI session gets harvested. Detect stale session errors, auto-create new session transparently, show "reconnecting..." indicator. Replay the failed message after reconnect. *(shipped v0.19.4)*
- [x] **Lens views invisible until mind reload** `bug`— `ViewDiscovery.startWatching()` bails if `.github/lens/` doesn't exist when the mind loads (line 110). New views created after load are never discovered. Fix: watch `.github/` parent dir and start lens watcher when `lens/` appears, or rescan on `lens:getViews` IPC when cache is empty. *(shipped v0.19.7)*
- [ ] **Lens watcher doesn't handle deletion** `bug` — deleting a lens folder (e.g. `fleet-tasks/`) leaves the view in Chamber's activity bar. Watcher detects creation but not removal. Fix: handle `unlink`/`unlinkDir` events in `ViewDiscovery` and remove the view from the registry + notify renderer. *(Ian, 2026-04-13)*
- [ ] **Agent doesn't load SOUL/memory on first message** `bug`— after genesis, saying "hi" doesn't trigger the agent to read SOUL.md and .working-memory files. Agent instructions not being injected into session context.
- [ ] **New Mind missing extensions/skills** `bug` — genesis bootstrap doesn't install extensions (cron, canvas, idea) or skills (commit, daily-report, etc.). New minds start bare.
- [ ] **Inject local time/timezone into every prompt** `bug` — agent should know the time without shelling out. Inject `current_datetime` and timezone into each `session.send()`. SDK has a `current_datetime` section in the prompt template.
- [ ] **"Stuck at thinking" — duplicate agent causes tool name clash** `bug` `p1` — on Ragu's machine, creating a second Alfred agent (same mind folder) causes all extensions to fail: `"External tool name clash: cron_create, ... already registered by another connection"`. The second session can't register cron, canvas, idea, or responses extensions because the first session already owns those tool names. Agent appears stuck at "thinking" with no extensions loaded. Also: `"Failed to load memories: GitHub repository name is required"` (non-blocking, logged as ERROR but stream continues). Fix: prevent duplicate mind sessions, or namespace extension tools per-session; surface extension failures to UI. Logs in q mind `inbox/logs-ra/`. *(Ragu, 2026-04-13)*
- [ ] **Teams Agency MCP issue** `bug` — Kent reported problem with Teams MCP proxy; shared log in AET SWE Chat. Needs investigation. *(Kent, 2026-04-09)*
- [ ] **No Start Menu icon** `bug` — installer doesn't create Start Menu shortcut. Likely Electron Forge / Squirrel config in packaging step.
- [ ] **Upgrade genesis-created minds on open** `bug` — minds created via CLI genesis (not Chamber) may be missing lens defaults, lens skill, and other Chamber-specific bootstrapping. When a mind is opened in Chamber for the first time, detect and run `seedLensDefaults` + `installLensSkill` + any missing capabilities. *(Ian, 2026-04-12)*
- [x] **Boot screen shows stale version** `bug` — fixed: imports version from package.json dynamically. *(fixed v0.18.0)*
- [ ] **Landing screen needs a back button** `ux` — when "Add Agent" navigates to the landing screen, there's no way to go back if you change your mind. Add a back/cancel action that returns to the previous chat view. *(Ian, 2026-04-12)*
- [ ] **Lens refresh survives view switching** `ux` — clicking away from a lens while it's refreshing drops the pending result. The agent still writes the file, but the UI never picks up the new data. Either show a toast when refresh completes, or re-read data when returning to the view. *(Ian, 2026-04-12)*
- [ ] **Popout should continue conversation** `ux` — popping out an agent starts a fresh chat instead of continuing the current conversation. Messages should transfer to the popout and return when closed. Related to conversation history feature. *(Ian, 2026-04-12)*
- [x] **Settings view + Logout** `ux` `auth` — ⚙ gear icon bottom-pinned in ActivityBar opens Settings view. Account section shows current login + Logout button. Logout deletes keytar credential, broadcasts to all windows, AuthGate drops to AuthScreen. *(shipped v0.20.0)*

## Next

- [ ] **Switch Account** `ux` `auth` — credential picker dropdown in Settings showing cached GitHub accounts (e.g. `ianphil`, `ianphil_microsoft`). Select to switch without re-auth. "Add Account" triggers device flow to cache a new credential. Requires multi-credential awareness in AuthService. *(Ian, 2026-04-15)*
- [ ] **Duplicate agent name collision** `bug` — creating a second agent with the same name as an existing one (e.g. "Alfred" twice) has undefined behavior. Detect name collisions during agent creation, either block with an error or auto-suffix. Clarify what happens to routing, IPC channels, and chatroom @mentions when names collide. *(Ian, 2026-04-13)*
- [ ] **Target Linux / WSL** `platform` — primary platform target should be Linux and WSL, not just Windows. Audit platform-specific code (paths, shell spawning, credential storage, installers) and ensure first-class support. *(Ian, 2026-04-13)*
- [ ] **Per-agent model selection**`ux` `arch` — each agent should have its own model config (e.g. Moneypenny on Opus, Q on GPT-5.4). Persist per-mind in agent config so it survives restarts. Today all agents use the same model. Need: model picker in agent settings, storage in mind config or agent.md frontmatter, pass model override to `session.send()`. *(Ian, 2026-04-13)*
- [ ] **Agent management (add/remove/list)** `ux` `arch` — Chamber should support adding and removing agents from the fleet, not just Lens views. Today updating the roster requires manually editing SOUL.md files and reloading agents. Chamber should: add a new agent, remove an agent, view/list current agents and their roles. Natural extension of Chamber's configuration capabilities. *(Ian, 2026-04-13)*
- [ ] **@mention targeting in chatroom** `ux`— `@AgentName` in a chatroom message should route only to that agent (not broadcast). Parse @mentions from input, filter broadcast participants to only the mentioned agent(s). That agent responds and does work; others stay silent. *(Ian, 2026-04-13)*
- [ ] **Generic `handleChatEvent<T>`** `quality` — `handleChatEvent` returns `ChatMessage[]` but chatroom reducer casts to `ChatroomMessage[]`. Make function generic to preserve extended types. *(Uncle Bob review, 2026-04-13)*
- [ ] **Chatroom roundId alignment** `bug` — renderer generates optimistic roundId, service generates a different one. Pass roundId through IPC so both sides agree. *(Uncle Bob review, 2026-04-13)*
- [ ] **IPC input validation on chatroom:send** `security` — no runtime type guards; renderer could send non-string. Add `typeof message !== 'string'` guard. *(Uncle Bob review, 2026-04-13)*
- [ ] **DRY session creation in MindManager** `quality` — `createChatroomSession` and `createTaskSession` share ~8 lines of identical body. Extract private `buildSessionForMind(mindId)`. *(Uncle Bob review, 2026-04-13)*
- [ ] **Chatroom agent timeout visibility** `ux` — 5-min timeout in `sendToAgent` resolves silently with no UI indication. Emit timeout-specific error event. *(Uncle Bob review, 2026-04-13)*
- [ ] **Chatroom `getLastNRounds` performance** `quality` — uses `Array.includes` in loop (O(n·r)). Replace with `Set`. *(Uncle Bob review, 2026-04-13)*
- [ ] **Chat history** `ux` — conversations are lost on new conversation or restart. Show past conversations per-mind in MindSidebar, indented under each agent. Data already in `~/.copilot/session-state/`. See [[conversation-history]] for spec. *(Ian, 2026-04-12)*
- [ ] **Boot screen activity log** `ux` — spinner too passive during genesis/startup; surface log output so user sees real-time progress. *(Kent feedback 2026-04-09)*
- [ ] **"Open Existing" defaults to ~/agents/** `ux` — folder picker should open to `$HOME/agents/` by default (where `MindScaffold.getDefaultBasePath()` creates minds).
- [ ] **Surface agent questions in chat** `ux` — #13, `onUserInputRequest` returns "Not available" — agent questions never reach the user.
- [ ] **Session startup performance** `perf` — pre-warm `getSharedClient()` at app launch (CLI spawn + auth in background while user is on landing screen). Also: session reuse via `resumeSession` API.
- [ ] **CSP and sandbox** `security` — add Content-Security-Policy via `onHeadersReceived`, enable `sandbox: true`. #1, #2.
- [ ] **Centralized IPC channel constants** `ipc` — `shared/ipc-channels.ts` with nested semantic namespacing (`IPC.CHAT.SEND`, `IPC.CONFIG.SAVE`).
- [ ] **Shared ElectronAPI type** `ipc` — single interface in `shared/electron-types.ts`, preload implements, renderer consumes. Kill `as unknown as` cast. #14.
- [ ] **Zod validation on IPC handlers** `ipc` `security` — schema validation on `config:save` and complex payloads. Preload stays passthrough. #4.
- [ ] **Test suite** `quality` — Vitest unit → IPC integration → Playwright E2E. No tests exist today.
- [x] **CI/CD pipeline** `quality` — tag-based release workflow for multi-platform builds. *(shipped v0.19.6)*
- [x] **ESLint clean + pre-commit hook** `quality` — zero errors/warnings, Husky + lint-staged. *(shipped v0.19.6)*

## Later

- [ ] **Unsaved changes indicator + Save button** `ux` — visual when mind has uncommitted changes; "Save" commits for execs who don't know git.
- [ ] **Multiple assistant personalities** `ux` — multiple agent personas in the voices screen. *(Kent feedback 2026-04-09)*
- [ ] **Agent alerts / notifications** `ux` — system toasts + taskbar flash via `notify` tool and/or CronMonitor service. Electron `new Notification()` + `BrowserWindow.flashFrame()`.
- [ ] **Scratch pad / work queue** `ux` — notepad for async handoff. User drops notes while agent is busy; agent triages when idle.
- [ ] **Agency MCP config** `lens` — Lens editor view over MCP server config.
- [ ] **Upgrade from genesis UI** `ux` — button/menu for discovering and installing genesis updates without typing a prompt.
- [ ] **Upgrade to Myelin memory** `arch` — migration from flat-file `.working-memory/` to `shsolomo/myelin` knowledge graph.
- [ ] **Move Responses API to frontier** `arch` — extract responses extension from genesis to frontier repo.
- [ ] **Extension lib refactor** `arch` — shared lib for CLI extensions + Lens views.
- [ ] **Connection health check** `arch` — real SDK health, not synthetic `mindPath !== null`. #12.
- [ ] **Harden mind path validation** `security` — traversal/symlink checks. #3.
- [ ] **Permission prompt flow** `security` — replace auto-approve with user prompt. #5.
- [ ] **Navigation guards** `security` — `will-navigate` + `setWindowOpenHandler` to block arbitrary URL navigation.
- [ ] **Electron Fuses audit** `security` — verify `RunAsNode: false`, `OnlyLoadAppFromAsar: true`, `EnableEmbeddedAsarIntegrityValidation: true`.
- [ ] **Per-domain handler modules** `ipc` — split handlers into `registerChatHandlers()`, `registerConfigHandlers()`, etc.
- [ ] **Listener cleanup audit** `ipc` — verify every `ipcRenderer.on()` returns unsub function. Wire into React effect cleanup.
- [ ] **Dynamic channels for extensions** `ipc` — chatbox MCP transport pattern for Chamber extensions. Per-instance channels with cleanup on close.
- [ ] **Lens view load time** `perf` — profile discovery scan, file reads, renderer-side rendering.
- [ ] **Replace AuthService C# with keytar** `quality` — native module for credential storage, cross-platform.
- [ ] **Gate console.log** `quality` — debug flag for 50+ log statements. #18.
- [ ] **Polish pass** `quality` — dark mode toggle, app icon, empty states.
