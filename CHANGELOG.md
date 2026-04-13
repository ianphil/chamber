# Changelog

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
