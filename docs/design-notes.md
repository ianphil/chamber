# Alt-Blog: What Chamber Can Learn From t3code

Notes from a survey of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (at `7a08fcf2`, ~841 tracked files) as a reference for Chamber's architecture. t3code is a minimal web GUI for coding agents (Codex, Claude) that ships as both `npx t3` and a desktop Electron app from a single codebase.

## TL;DR

t3code's big architectural idea is that **the UI is a web app and Electron is just one of three ways to load it**. The same Node server binary powers `npx t3` (opens a browser), the desktop app (Electron loads `localhost`), and remote pairing mode. Chamber currently welds main + renderer together through Electron IPC; adopting t3code's split would unlock a web/CLI shell for free and force our IPC surface to become a real, validated protocol.

## Architecture snapshot

| | Chamber | t3code |
|---|---|---|
| Topology | Electron main + renderer + preload | Thin Electron + standalone Node WS server + React/Vite web app |
| Monorepo | Single package | `bun` workspaces + `turbo` (`apps/{desktop,server,web,marketing}`, `packages/{contracts,shared,client-runtime}`) |
| Contracts | `src/shared/types.ts` — plain TS | `packages/contracts` — Effect `Schema` for WS protocol, provider events, session types |
| Transport | Electron IPC | WebSocket RPC (`NativeApi`) + server-push channels (e.g. `orchestration.domainEvent`) |
| State / runtime | React + custom reducer | Heavy use of Effect (`@effect/atom-react`, `@effect/platform`, `@effect/sql-sqlite-bun`) |
| Lint / fmt | ESLint | `oxlint` + `oxfmt` (Rust, ~instant) |
| Tests | Vitest, some nested dirs | Vitest, colocated flat (`foo.ts` / `foo.test.ts`), MSW + Vitest browser for web |
| Shared exports | Barrel `src/shared/index.ts` | No barrel — explicit subpath exports (`@t3tools/shared/git`) |
| Bundling | Vite for main/preload/renderer | `tsdown` for libs, Vite for web, `turbo` orchestrates |
| Ops | Basic | `updateMachine`, `rotatingFileSink`, `observability/`, `telemetry/`, `backendReadiness`, `serverListeningDetector` |

## How `npx t3` actually works

This was the headline discovery. The mechanism:

- `apps/server` publishes to npm as the package **`t3`** with `"bin": { "t3": "./dist/bin.mjs" }`. That's what `npx t3` runs.
- `apps/web` is a standalone React/Vite SPA.
- At server build time, `apps/server/scripts/cli.ts` runs `turbo build` for web, then **copies `apps/web/dist` into `apps/server/dist/client`**:

  ```ts
  const webDist = path.join(repoRoot, "apps/web/dist");
  const clientTarget = path.join(serverDir, "dist/client");
  if (yield* fs.exists(webDist)) yield* fs.copy(webDist, clientTarget);
  ```

- The server tarball ships with `"files": ["dist"]`, containing both the Node WS server and the static SPA.

At runtime:

- Server binds `http://localhost:PORT`, serves `/` from `dist/client/index.html` + assets, upgrades `/ws` for WebSocket RPC.
- `serverRuntimeStartup.ts` calls `openBrowser(target)` (unless `--no-browser`).
- **Desktop** mode is the same server; Electron just `loadURL`s `http://localhost:PORT` instead of opening a browser. `serverConfig.mode === "desktop"` skips the pairing-URL auth dance since it's trusted-local.
- In dev, `devUrl` points at Vite's `http://localhost:5173` so the server redirects there instead of serving stale `dist/client`.

Consequences:

1. **One codebase, three shells.** `npx t3` (browser), desktop Electron, remote pairing (`REMOTE.md`, `issueStartupPairingUrl` auth token flow).
2. **The Electron app is ~15 files.** Almost everything is in `server` + `web`. Electron is a thin loader + auto-updater + OS integration (shell env sync, confirm dialogs, rotating file sinks).
3. **Tests don't need Electron.** Server tests run pure Node; web tests run in Vitest browser mode. Electron runs only in `smoke-test`.
4. **Auth gating differs per mode.** Local desktop = implicit trust; `npx` / remote = pairing token URL. Same server, config-driven.

## Findings worth stealing for Chamber

### 1. Effect Schema contracts package

Chamber's IPC is typed but not runtime-validated. A `packages/contracts` with Schema-based definitions would catch malformed payloads at the boundary from the SDK, filesystem (`view.json`), and agents. Lens is literally "drop a JSON, agent extends UI" — it's our weak spot and the place where runtime schema validation pays the highest dividend.

Rule from t3code's `AGENTS.md`: **contracts package is schema-only — no runtime logic**. Prevents the usual drift where protocol types grow helpers and bleed server-only deps into the client.

### 2. Headless server + web shell

Extract main-process services into a runnable Node process behind a WebSocket + JSON-RPC surface. Unlocks `npx chamber`, remote / web UI, and makes tests trivial (no Electron).

Mapping to Chamber today:

- `apps/server` ← current `src/main/` services. SdkLoader, ChatService, ViewDiscovery, ExtensionLoader, Lens file watcher all run here. Talks WebSocket + JSON-RPC instead of `ipcMain.handle`.
- `apps/web` ← current `src/renderer/`. Uses a WS client instead of the `window.chamber.*` preload bridge.
- `apps/desktop` ← minimal Electron: window, auto-updater, menu, shell env, deep-linking, native file pickers. Loads `http://localhost:PORT` (or the dev Vite URL).
- `npx chamber` ← start server, open browser. Minds still live on the user's filesystem; Lens `view.json` discovery still works because the server has FS access.

Side effect: Lens "self-extending UI" works **better** in a browser — sharing a view with a collaborator becomes a URL.

Friction point: Chamber's preload exposes Node-ish APIs (file ops, shell) that the renderer relies on. Moving to WS RPC means every one of those becomes an explicit RPC method in `packages/contracts`. That's actually the goal of (1), so the two ideas reinforce each other.

### 3. Drop the `src/shared/` barrel

Switch to subpath exports (`@chamber/shared/lens`, `@chamber/shared/sessionErrors`). Prevents accidental renderer imports of main-only code and improves tree-shaking. t3code's `AGENTS.md` explicitly calls this out.

### 4. `oxlint` + `oxfmt`

Drop-in replacement for ESLint. Near-instant on a repo t3code's size. Chamber's ESLint config is small enough to port with little effort.

### 5. Update state machine + rotating log sink

Chamber ships as Electron but has nothing for auto-update or structured logs. `apps/desktop/src/updateMachine.ts` and `rotatingFileSink.ts` are short, readable references.

### 6. `AGENTS.md` discipline

Short, punchy root-level doc that enforces `bun fmt && bun lint && bun typecheck` before "done," documents per-package roles, and lists reference repos. Chamber has agent-instruction bits scattered across `.github/` — consolidating into a single `AGENTS.md` would be an easy win.

## Things worth **not** copying

- **Flatten everything.** t3code keeps `apps/server/src/` mostly flat with ~50 top-level files. Chamber's `services/*` split (a2a, chat, chatroom, genesis, lens, mind, sdk) is a meaningful domain grouping, not folders-for-folders'-sake. Keep it.
- **Full Effect adoption.** Effect has a real learning curve and pervades everything (layers, runtime, generators). Adopting it wholesale is a bigger commitment than it looks. Use Effect `Schema` for contracts only; don't rewrite the runtime.
- **`bun` as the package manager.** Chamber runs on Node + npm and `npm run lint`/`npm test` are the verified baseline. Switching runtimes is a separate conversation.

## Things Chamber already does better

- **Lens framework** (`view.json` → UI). t3code has no equivalent; it's a fixed UI for Codex/Claude. This is Chamber's real differentiator.
- **Agent-as-first-class** (identity, personality, minds). t3code treats the coding agent as a provider, not a persona.
- **Genesis flow / mind bootstrapping.** Nothing like it in t3code.

## Suggested sequencing (if we pursue the big split)

1. Introduce `packages/contracts` with Effect `Schema` mirroring the current IPC surface. No behavior change.
2. Stand up `apps/server` exposing the same surface over WebSocket + JSON-RPC. Run it as a sidecar from the existing Electron main process.
3. Shim the preload bridge to call WS instead of `ipcRenderer.invoke`. Renderer is unchanged. Ship this intermediate state — everything still works, but the boundary is now a real protocol.
4. Extract `apps/web` and slim Electron down to a window + updater shell.
5. Add `npx chamber` bin. Layer in pairing-URL auth for remote mode.

Each step is independently shippable and reversible.

## Chat rendering semantics

Separate deep-dive. t3code's chat UI is strikingly different from Chamber's, and the differences aren't cosmetic — they reflect a different mental model of what a conversation is.

### How Chamber renders today

- Uniform layout: avatar + name + timestamp header + content, same for user and assistant.
- Every reasoning section and every tool call is its own `Collapsible` card (`ToolBlock`, `ReasoningBlock`). Five tool calls in a turn = five stacked cards.
- No turn boundaries, no virtualization, no duration indicators.
- `MessageList.tsx` is ~67 LOC with a plain `messages.map()`.

### How t3code renders

Key insight: **the conversation isn't a list of messages — it's a list of heterogeneous timeline rows.**

Row kinds (from `MessagesTimeline.logic.ts`):

```ts
type MessagesTimelineRow =
  | { kind: "work";          groupedEntries: WorkLogEntry[] }
  | { kind: "message";       message: ChatMessage; ... }
  | { kind: "proposed-plan"; proposedPlan: ProposedPlan }
  | { kind: "working";       createdAt: string | null };
```

`deriveMessagesTimelineRows()` walks the raw event stream and **collapses adjacent tool/reasoning/info/error events into a single `work` row**. Messages, plans, and the working indicator become peer rows — not nested children of messages.

Per-row visual treatment:

- **User message.** Right-aligned chat bubble, `rounded-2xl rounded-br-sm`, max-width 80%, secondary background. No avatar, no name. Timestamp in the bottom-right of the bubble. Copy + "revert to here" controls fade in on hover.
- **Assistant message.** Full-width markdown prose. No bubble, no avatar, no name header. A tiny muted meta line at the bottom: `09:42 • 2.4s`. Copy button fades in on group-hover. If the turn modified files, a `Changed files (N) • +12 −3` panel with a tree view and "View diff" button auto-appends.
- **Work row.** One compact panel labeled `Work log (N)` or `Tool calls (N)`. Each entry is a **single line**: icon (Terminal / Eye / SquarePen / Wrench / Hammer / Globe / Zap per request kind) + heading + inline preview (command, path, or `file.ts +3 more`). Over 6 entries → truncates to last 6 with a `Show 12 more` button. Expands inline; no modal, no individual card per tool.
- **Proposed-plan row.** Its own `ProposedPlanCard`, not nested inside a message.
- **Working row.** Three animated dots + a self-ticking `Working for 14s` timer.
- **Turn divider** between turns: `────── Response • 2.4s ──────` chip, marking turn boundary and duration.

Rendering discipline — four things that make it feel good:

1. **Virtualized** with `@legendapp/list` (`LegendList`): `estimatedItemSize={90}`, `maintainScrollAtEnd`, `initialScrollAtEnd`. Handles long threads without stutter.
2. **Structural sharing** via `useStableRows` → `computeStableMessagesTimelineRows` reuses prior row object refs when shallow-equal, so LegendList + React's memo boundaries skip untouched rows during streaming chunks.
3. **Shared state via context, not props.** A `TimelineRowCtx` carries per-row callbacks + flags. `renderItem` has zero closure deps, so its reference is stable across streaming chunks.
4. **Self-ticking leaf components.** `WorkingTimer` and `LiveMessageMeta` own their own `setInterval` state. An elapsed-time tick never re-renders the parent list.

### Why Chamber's current pattern breaks down

Three real problems t3code solves:

1. **Noise.** Five tool calls = five cards. t3code's grouped work panel shows five one-line entries in a single bordered box. ~80% less chrome for the same information.
2. **No turn structure.** In a long conversation, you can't tell where one turn ended and the next began. The `Response • Xs` divider fixes this and also gives the user a latency cue.
3. **Symmetric styling hides who's talking.** User-as-bubble + assistant-as-prose is what nearly every current chat UI has settled on (ChatGPT, Claude, Cursor). Chamber's symmetric avatar+name pattern feels more like Slack than an agent surface.

Additional wins worth stealing:

- **Promote Lens side effects to first-class timeline rows.** When a Lens view mutation happens mid-conversation, instead of burying it in a tool block, render a `{ kind: "view-updated"; viewId; summary }` row — parallel to t3code's `proposed-plan` row. This is the shape Lens actually wants.
- **Changed-files analog for view mutations.** Auto-append a `Modified N views` summary under the assistant message when a turn touched `.github/lens/`.
- **Virtualization + structural sharing.** Chamber streams. A 50-turn conversation with streaming reasoning will jank without this.
- **Live timers in isolated leaf components** so streaming doesn't trigger whole-list re-renders.

### What's probably overkill to copy right now

- `@legendapp/list` dependency — pick a virtualizer only when long threads actually jank. `react-virtuoso` is simpler if/when we need one.
- The dual `MessagesTimeline.tsx` + `MessagesTimeline.browser.tsx` split (that's Vitest browser-mode plumbing).
- t3code's `work` row icon taxonomy is coding-agent specific (Terminal, SquarePen, Wrench). Chamber's taxonomy should be Lens-oriented: `view.read`, `view.write`, `mind.invoke`, `lens.create`, etc.

## The highest-leverage change

Of everything above, one change gets ~80% of the visual improvement for ~20% of the effort, and is independent of the architectural rewrites: **replace the per-block `Collapsible` cards with a turn-level `WorkGroup`.**

### What changes

Today, in `StreamingMessage.tsx`, each assistant message renders its `blocks` as a flat list where each `reasoning` or `tool` block becomes its own `Collapsible`. Change the rendering pass to:

1. Iterate blocks. Text blocks render as-is (markdown prose).
2. Consecutive non-text blocks (reasoning + tool) accumulate into a single `WorkGroup`.
3. Each non-text block becomes a **one-line entry** inside that group: icon + short heading + inline preview (first line of command, file path, etc.).
4. If the group has >N entries (start at 6), show the last N with a `Show M more` button.
5. Clicking an entry can still expand to show its full content inline — but the default is the compact line.

### Why this is the right first move

- **Purely additive at the data level.** No schema change. Existing `blocks` stream works unchanged.
- **Localized.** Touches `StreamingMessage.tsx`, adds a `WorkGroup.tsx`, adjusts `ToolBlock.tsx` / `ReasoningBlock.tsx` to expose a compact line mode. Nothing outside `components/chat/` moves.
- **Reversible.** Feature-flaggable behind a config key if we want A/B.
- **Compounds with later work.** When we later introduce the full `MessagesTimelineRow` model, `WorkGroup` is already the UI for the eventual `kind: "work"` row — we're just moving where the grouping decision happens (from render-time to event-derivation-time).

### Scope of the change

Concretely, a ~1-day piece of work:

- New `WorkEntry` type — what a one-liner looks like: `{ icon, heading, preview, detail, tone }`.
- New `WorkGroup.tsx` component — bordered panel, compact header `Work log (N)`, last-N-visible truncation with "Show M more".
- New `WorkEntryRow.tsx` — one-line icon + heading + preview, inline expand-to-detail on click.
- Refactor `StreamingMessage.tsx` — group consecutive non-text blocks into a `WorkGroup`; render text blocks between groups.
- Adapt `ToolBlock` / `ReasoningBlock` content renderers to be used inside `WorkEntryRow`'s expanded detail (reuse, don't rewrite).
- Snapshot-style tests: given a synthetic block sequence, assert the flattened work group output.

### What we deliberately defer

- Turn boundaries / `Response • Xs` dividers → depends on turn metadata we don't all expose yet.
- User-as-bubble asymmetric styling → design call, separate PR.
- Virtualization → only when it matters.
- Live elapsed timers → nice-to-have.
- First-class `view-updated` timeline rows → depends on the bigger timeline refactor; tracked separately.

### Rubber-duck check

One thing to be careful about: **streaming blocks arrive incrementally, and a tool block's text can grow over many frames.** The grouping logic must be stable as new content arrives within an existing block (don't re-key), and must be stable when a new block appends at the end (don't re-key earlier rows). Use block `id` as the React key, not position. Today's code already keys by block id, so this carries over, but the `WorkGroup` wrapper needs a stable key derived from the first block's id in the group, not the group's index.

## Locked decisions

Recorded here so we don't relitigate them every time we pick the work back up.

1. **Contracts library: `zod`.** Ubiquitous, zero friction, strong TS inference, no runtime ecosystem lock-in. If we later adopt more of Effect for good reasons, migrate to Effect `Schema` then — not speculatively.
2. **Monorepo tooling: npm workspaces + `turbo`.** Smallest blast radius from where Chamber is today. Keep the existing Node + npm runtime. `turbo` gives us the task graph we need without swapping package managers. Bun adoption is a separate, later conversation.
3. **WebSocket library: `ws` + a thin JSON-RPC 2.0 wrapper we own.** `ws` is the smallest thing that works. The wrapper is ~100 LOC, zero new concepts, directly mirrors the JSON-RPC spec. Rejected: `socket.io` (too much machinery), `tRPC` (ties us harder to TS at both ends than needed), `gRPC` (overkill, codegen).
4. **Sequencing: WorkGroup chat refactor first, then the architecture split.** WorkGroup is purely renderer-side, ships user-visible value immediately, and is independent of the split. We land it on its own branch off `devel`, merge back, *then* start Phase 1 of the architecture refactor (contracts package). WorkGroup gives us a UI we like living inside the current Electron+IPC world before we start moving the walls.

## Caveats

- t3code is explicit WIP (see `CONTRIBUTING.md`). Their own design may still churn.
- ~5× Chamber's LOC, so not every pattern generalizes — some are weight Chamber doesn't carry yet.
- The Effect ecosystem is opinionated. Schema is great; don't assume the rest is.
