# GitHub Copilot Instructions — Chamber

These instructions tell Copilot how to produce code that fits the Chamber codebase. They reflect patterns that already exist here. When in doubt, prefer consistency with surrounding code over external best practices.

## Priority Guidelines

1. **Version compatibility** — match the exact versions pinned in `package.json` and `.nvmrc`. Never use APIs newer than what is installed.
2. **Architecture first** — respect the dependency direction described in *Architecture* below. A change that violates it is wrong, even if it compiles.
3. **Read these files first** when context is needed: `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `tsconfig.json`, `eslint.config.mjs`.
4. **Codebase patterns over invention** — scan neighboring files (same folder, same kind of test, same kind of service) and copy their shape. Do not introduce a pattern that does not already exist somewhere in `src/`.
5. **Security boundaries are non-negotiable** — see *Security* below.

## Stack & Versions (pinned)

- **Runtime**: Node `24.15.0` (`.nvmrc`), Electron `41`
- **Language**: TypeScript `6.0`, ESM source (CommonJS module target in `tsconfig.json`), `target: ESNext`, `strict: true`, `noImplicitAny: true`, `moduleResolution: bundler`, JSX `react-jsx`
- **Path alias**: `@/*` → `./src/*` (tsconfig + `config/vitest.config.ts` + `components.json`)
- **UI**: React `19`, Tailwind CSS `4`, shadcn/ui style `radix-nova` (Radix primitives + CVA + `tailwind-merge` + `clsx`), Lucide icons
- **Markdown**: `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js`
- **Build**: Electron Forge `7.11` + `@electron-forge/plugin-vite` + Vite `8`
- **Testing**: Vitest `4`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
- **Lint**: ESLint `10` flat config, `typescript-eslint` `8`, `eslint-plugin-import-x`
- **Copilot SDK**: `@github/copilot-sdk@0.3.0` and `@github/copilot@1.0.39` — both **pinned exactly**, not ranged. The runtime is committed under `chamber-copilot-runtime/` and shipped in the package; do not bump either without a coordinated changelog entry.
- **Other**: `keytar@7` (credentials), `croner@10` (cron), `radix-ui@1`, `class-variance-authority@0.7`

> **Invariant**: `tsconfig.json` deliberately leaves `ignoreDeprecations` disabled. Fix deprecation warnings, do not suppress them.

## Architecture

Chamber is an Electron desktop app with three layers under `src/`:

```
src/
  main.ts            # Composition root — wires factories → services → IPC
  preload.ts         # Bridge — exposes a typed API to the renderer
  renderer.tsx       # Renderer entry
  main/              # Electron main process
    services/        # Business logic, organized by capability
    ipc/             # Thin ipcMain.handle adapters (one file per service)
    integration/     # Cross-service integration tests
    contextMenu/, tray/, assets/, wireLifecycleEvents.ts
  renderer/          # React UI
    App.tsx, components/, hooks/, lib/, index.css, env.d.ts
  shared/            # Types and utilities used by both main and renderer
  tests/             # Cross-cutting regression tests and Playwright E2E smoke tests
```

### Dependency direction

- **Renderer → Shared** ✅ (types only, no Electron imports)
- **Main → Shared** ✅
- **Main → Renderer** ❌ (never)
- **Shared → Main or Renderer** ❌ (never)
- **Services** depend on injected ports/factories, not on Electron globals. The composition root (`src/main.ts`) is the *only* place that constructs and wires services. IPC adapters are thin and parameter-injected; they call services, not vice versa.

### Service layout

Each capability lives in its own folder under `src/main/services/<capability>/`:

```
ChatService.ts        # the service
ChatService.test.ts   # colocated unit tests
TurnQueue.ts          # collaborators in the same folder
TurnQueue.test.ts
index.ts              # barrel — public surface only
types.ts              # local types when shared inside the folder
```

Existing capabilities: `a2a`, `auth`, `canvas`, `chamberTools`, `chat`, `chatroom` (with `orchestration/` subfolder for strategies + `approval-gate.ts` + `observability.ts`), `config`, `cron`, `genesis`, `lens`, `mind`, `sdk`.

Add a new capability the same way. Do not flatten services into `src/main/`.

### IPC pattern

IPC adapters are pure plumbing (`src/main/ipc/<name>.ts`):

```ts
// chat.ts — thin adapters for ChatService
import { ipcMain, BrowserWindow } from 'electron';
import type { ChatService } from '../services/chat/ChatService';

export function setupChatIPC(chatService: ChatService, mindManager: MindManager): void {
  ipcMain.handle('chat:send', async (event, mindId: string, message: string, ...) => {
    // marshal args, call the service, forward events via webContents.send
  });
}
```

Conventions:

- Channel names are `lowercase:colon` (`chat:send`, `chat:event`, `mind:list`, `lens:get`).
- Adapters take services as constructor-style parameters; they do **not** new-up services.
- Streaming events go back via `win.webContents.send(channel, ...args)` with discriminated-union payloads (`{ type: 'reconnecting' }`, `{ type: 'error', message }`, `{ type: 'done' }`).
- The composition root in `src/main.ts` calls `setupXxxIPC(...)` once at `app.on('ready', ...)`.

### BrowserWindow webPreferences (do not weaken)

```ts
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // required by copilot-sdk preload — mitigated by the two flags above
}
```

## Coding Conventions

Observed across the codebase:

- **Imports**
  - `import type { ... }` for type-only imports (used heavily — keep doing it).
  - `node:` protocol for Node builtins: `import path from 'node:path'`, `import { randomUUID } from 'node:crypto'`.
  - Use the `@/` alias for cross-folder imports inside `src/`. Use relative imports inside the same feature folder.
  - Barrels (`index.ts`) export only the public surface of a folder.
- **Modules**: ESM source (`import`/`export`), no `require` in TS.
- **Naming**
  - Classes: `XxxService`, `XxxManager`, `XxxFactory`, `XxxDiscovery`, `XxxScaffold`, `XxxRegistry`, `XxxQueue`, `XxxRouter`.
  - Files: PascalCase for class files (`ChatService.ts`), camelCase for utilities (`createIpcListener.ts`, `generateMindId.ts`, `wireLifecycleEvents.ts`).
  - Constants: SCREAMING_SNAKE_CASE with numeric separators (`SEND_TIMEOUT_MS = 30_000`, `DEFAULT_TURN_TIMEOUT_MS = 300_000`).
  - IPC channels: `domain:verb` (lowercase).
- **Functions**: small, single-responsibility, imperative verbs (`createWindow`, `requestQuit`, `streamTurn`).
- **Errors**
  - Throw `Error` with descriptive messages.
  - For protocol-level signaling, prefer typed event unions over throwing across boundaries.
  - Detect SDK-shaped errors via predicates in `src/shared/sessionErrors.ts` (e.g. `isStaleSessionError`). Add new predicates there rather than ad-hoc string checks in services.
- **Async**: `async`/`await` throughout; `AbortController` for cancellation; never block the event loop.
- **Comments**
  - JSDoc on exported functions and constants when behavior is non-obvious (see `src/shared/sessionErrors.ts`).
  - Section banners (`// ----`) only inside files that have multiple grouped concerns.
  - `// INVARIANT:` marks rules that must not be silently changed (see `tsconfig.json`).
  - Inline comments explain *why*, not *what*.
- **Dependency injection**: constructor injection, no DI container. Prefer interfaces (TypeScript `interface` or `type`) over concrete dependencies in service constructors when a fake will be needed for tests.

## Change Discipline

- **Surgical edits**: every changed line should trace to the request. Don't reformat,
  rename, or "improve" code you weren't asked to touch. If you notice unrelated dead
  code or a smell, mention it in the PR body — don't fix it in the same PR.
- **Clean up your own orphans only**: remove imports/symbols *your* changes made unused;
  leave pre-existing dead code alone unless the task is cleanup.
- **No speculative scope**: no abstractions for single-use code, no configurability that
  wasn't asked for, no error handling for branches that can't execute. Validate at
  service boundaries, not everywhere.
- **Define done before coding**: for bugs, write the failing test first. For features,
  state the verification step ("renderer test for X passes", "`npm run lint` clean",
  "smoke test still green"). Loop until each step verifies.

## React / Renderer

- React **19** with the new JSX transform (`react-jsx`) — do not import `React` for JSX; only import it when you actually use it.
- Function components only. Hooks live in `src/renderer/hooks/` (e.g. `useAgentStatus`).
- App state via `AppStateProvider` (`src/renderer/lib/store`), not Redux/Zustand.
- Layout composes gates: `<AppStateProvider><AuthGate><GenesisGate><AppShell/></GenesisGate></AuthGate></AppStateProvider>`. Add new top-level gates in `src/renderer/components/<area>/`.
- Styling: Tailwind v4 utility classes; reusable component variants via CVA. Use `cn()` from `@/renderer/lib/utils` to merge classes (shadcn convention).
- shadcn components live under `src/renderer/components/ui` per `components.json`. When generating new shadcn components, respect the configured `radix-nova` style and the `@/` aliases — do not regenerate to `src/components`.
- Never import from `electron` in the renderer. Reach the main process only through the preload-exposed API.

## Testing

Vitest is the test runner. Configuration is in `config/vitest.config.ts`.

- Tests are colocated with source: `Foo.ts` and `Foo.test.ts` in the same folder.
- Test names read like specifications, not test labels:
  - ✅ `it('serializes concurrent enqueues for the same mindId', ...)`
  - ❌ `it('test 1', ...)`
- Structure: `describe('Subject', () => { it('behavior', ...) })`. No `// Arrange/Act/Assert` comments — let the code speak.
- Imports: `import { describe, it, expect, vi, beforeEach } from 'vitest'`. Globals are enabled but explicit imports are the prevailing style.
- **Type-level tests**: use `expectTypeOf` from Vitest for type contracts (see `src/shared/chatroom-types.test.ts`).
- **Mocks/fakes**: prefer fakes (lambdas, in-memory stubs) over `vi.mock` of whole modules. Use `vi.fn()` for spies. Match the dependency-injection style — pass fakes through constructors.
- **Renderer tests**: use `@testing-library/react` and `@testing-library/jest-dom`. Set `environment: 'jsdom'` per-file via `// @vitest-environment jsdom` when needed (the global default is `node`).
- **Integration tests**: live in `src/main/integration/`.
- **Smoke**: `npm run test:sdk-smoke` exercises the live SDK runtime via `scripts/run-sdk-smoke-test.js`. Run when SDK paths change.
- **Packaging sandbox**: `npm run make:sandbox` builds the installer and runs `scripts/sandbox-test.js`. Run when packaging, runtime resolution, or first-launch behavior changes.

## Lint, Type-Check, Build

- `npm run lint` — `tsc --noEmit && eslint .` (zero warnings, zero errors).
- `npm run typecheck` — `tsc --noEmit` only.
- `npm test` — Vitest run.
- `npm start` — Electron Forge dev with hot reload.
- `npm run package` / `npm run make` — build artifacts via Forge.

ESLint flat config (`eslint.config.mjs`) is the source of truth. Notes:

- `**/*.{js,mjs,cjs}` are ignored — TypeScript only.
- `electron` is treated as a core module by `import-x`.
- `no-useless-assignment` and `no-constant-binary-expression` are intentionally **off** because the existing codebase has patterns that conflict; do not re-enable them in scope of unrelated work.

## Security Boundaries (from `AGENTS.md`)

These are not negotiable. Code that weakens them must be rejected.

- **Credentials**: stored via `keytar` (OS keychain) only. Never in mind directories, never in `.working-memory/`, never in source.
- **`.working-memory/`** is agent-managed. Never modify it in a PR.
- **Tool execution**: all tool calls flow through the Copilot SDK. The chatroom `ApprovalGate` (`src/main/services/chatroom/orchestration/approval-gate.ts`) gates side-effect tools; do not bypass it. The CLI runs with `--allow-all-tools --allow-all-paths --allow-all-urls` *because* Chamber owns the security boundary at the `ApprovalGate` and Electron sandbox layers — do not remove the gate to "compensate".
- **Observability** (`observability.ts`): structured events with parameter redaction (`redactParameters`). When you emit events for a new tool surface, route through the existing emitter and use redaction.
- **Lens views**: every `view.json` must validate against the Lens schema before rendering.
- **Canvas**: rendered HTML must be sandboxed. No access to Electron main-process APIs from canvas content.
- **Cron**: job kinds are bounded (prompt, process, webhook, notification). Do not introduce arbitrary shell execution.
- **Chat UI**: sanitize tool-call responses before display.
- **Multi-agent orchestration**: any change to chatroom orchestration (delegation limits, approval flow) requires explicit review of safety properties.
- **`webPreferences`** (above) — `contextIsolation: true` and `nodeIntegration: false` must remain. `sandbox: false` is required for the SDK preload bridge; do not change this without a coordinated security review.

## Pinned Runtime: `chamber-copilot-runtime/`

The packaged app ships its own `@github/copilot` + `@github/copilot-sdk` under `chamber-copilot-runtime/`. This is a committed runtime contract:

- `chamber-copilot-runtime/package.json` and `package-lock.json` define the pinned pair.
- `scripts/prepare-node-runtime.js` materializes it into the package via `npm ci` at package time.
- Bumping either dependency requires updating both files and validating with `npm run test:sdk-smoke` and `npm run make:sandbox`.

## Versioning, Changelog, PRs

- Semantic Versioning (`CONTRIBUTING.md`). Bump with `npm version major|minor|patch --no-git-tag-version`.
- Every released version gets a `CHANGELOG.md` entry following the existing format: `## vX.Y.Z (YYYY-MM-DD)`, grouped sub-headings, bullets that lead with a **bold one-liner**, then a dash, then detail. Reference issues with `(#N)`.
- Branches start from `master`, named `<type>/<short-desc>-<issue#>` (e.g. `fix/stale-model-picker-97`).
- PR bodies reference the issue with `Fixes #N` or `Closes #N`.
- Commit trailer required: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Use the `pr` skill (`.github/skills/pr/`) to drive the full release workflow.

## When You're Unsure

1. Look at the nearest sibling file. Copy its shape.
2. Look at how the composition root (`src/main.ts`) wires similar things.
3. Look at how IPC adapters in `src/main/ipc/` expose the closest existing capability.
4. Look at the closest test file. Copy its `describe`/`it` style.
5. If still unsure, ask. Don't invent.

The mess is never worth making. Consistency with what's already here beats novelty every time.
