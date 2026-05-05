# Chamber

Where AI agents are born and operate.

Chamber is a desktop app for AI agents that act as your Chief of Staff — managing priorities, surfacing context, and keeping operations moving. Connect a mind (an agent with memory, skills, and personality) and the agent extends the UI itself: drop a `view.json` into the mind and a new panel appears. No code changes, no deploys.

Built with Electron, React, Tailwind CSS, a local loopback server, and the GitHub Copilot SDK. Minds are created with [Genesis](https://github.com/ianphil/genesis).

## The Idea

Our agents aren't pre-programmed. The user chooses who they become.

Chamber is where that happens. Your agent wakes up, finds its voice, and prepares your world.

| The old world | Chamber |
|---------------|---------|
| Briefing book | Newspaper — prompt-driven daily briefing |
| Rolodex | Contacts — table view |
| Inbox tray | Inbox — list view |
| Intercom | Chat — streaming conversation with your agent |
| Filing cabinets | Domains, expertise, archives |
| The Chief of Staff | The agent |

## Features

- **Lens** — declarative view framework. Drop a `view.json` in `.github/lens/`, get a UI panel. 7 view types: form, table, briefing, detail, status-board, timeline, editor.
- **Prompt-driven views** — click Refresh, the agent gathers data and populates the view. Edit the prompt to change what it shows.
- **Write-back** — type instructions in the action bar on any view. The agent modifies the data.
- **Self-extending** — the agent has a Lens skill. Ask it to "create a view for my cron jobs" and it builds one.
- **Built-in canvas** — render HTML dashboards, reports, and forms in the browser with live reload and a simple action back-channel.
- **Built-in cron** — schedule prompt, process, webhook, and notification jobs per mind without installing per-mind extensions.
- **Activity bar** — VS Code-style icon strip. Icons appear as views are discovered.
- **Streaming chat** — real-time responses with markdown, tool calls, and reasoning blocks.
- **Chatroom** — multi-agent group chat with 5 orchestration modes: Concurrent (all agents respond in parallel), Sequential (round-robin), GroupChat (moderator-directed), Handoff (agent-to-agent delegation), and Magentic (manager-driven task ledger).
- **Marketplace install links** — enroll public, private, or internal Genesis mind registries from a `chamber://install?registry=...` link.
- **Model picker** — choose your model, persisted across sessions.
- **Agent identity** — chat shows the agent's name. This is their chamber.

## Quick Start

```bash
git clone https://github.com/ianphil/chamber
cd chamber
npm install
npm start
```

Select a mind directory from the sidebar. The agent connects, views appear, and you're ready.

## Genesis Marketplace Links

Marketplace maintainers can add a click-to-enroll link to a README or internal portal:

```markdown
[![Add to Chamber](https://img.shields.io/badge/Add%20to-Chamber-7c3aed)](https://chmbr.dev/install.html?registry=https%3A%2F%2Fgithub.com%2Fagency-microsoft%2Fgenesis-minds)
```

The GitHub Pages interstitial at `https://chmbr.dev/install.html?registry=<encoded registry URL>` opens the matching `chamber://install?registry=...` URL and shows a fallback copy button if Chamber is not installed.

## Architecture

Chamber is being split into a transport-oriented workspace layout so the UI can run either in a browser or inside Electron:

```
apps/
├── web      # Vite + React renderer, browser-runnable
├── server   # Loopback HTTP + WebSocket server
└── desktop  # Electron lifecycle shell and native bridge

packages/
├── shared
├── wire-contracts
├── client
└── services
```

This is a transport migration rather than a full use-case refactor: services remain the business-logic package, while HTTP/WS routes and the browser client provide the new delivery boundary. Electron is now treated as the desktop wrapper around the same web app and local server.

```
Electron Main Process
├── CopilotClientFactory — per-mind CopilotClient lifecycle
├── CanvasService       — browser-rendered HTML canvases with live reload
├── CronService         — built-in scheduled jobs and durable run history
├── ChatService         — streaming sessions, background prompts
├── ChatroomService     — multi-agent broadcast, orchestration strategy dispatch
│   └── orchestration/
│       ├── stream-agent.ts  — shared SDK event wiring + stale session retry
│       ├── shared.ts        — XML/JSON helpers shared across strategies
│       ├── ConcurrentStrategy, SequentialStrategy, GroupChatStrategy,
│       │   HandoffStrategy, MagenticStrategy
│       ├── approval-gate.ts — tool execution review gate
│       └── observability.ts — structured event emission with redaction
├── ViewDiscovery       — scans .github/lens/ for view.json, file watcher
├── Tray                — Windows close-to-tray lifecycle
└── IPC Handlers        — chat, chatroom, agent, lens, config channels

Preload Bridge
└── contextBridge    — narrow typed API (chat, agent, lens, config, window)

React Renderer
├── ActivityBar      — dynamic icons from discovered views
├── SidePanel        — contextual per view (chat, lens metadata)
├── ViewRouter       — routes to ChatPanel or LensViewRenderer
├── Lens components  — Form, Table, Briefing, Detail, StatusBoard, Timeline, Editor
├── Chat components  — MessageList, ChatInput, StreamingMessage, WelcomeScreen
└── Chatroom components — ChatroomPanel, OrchestrationPicker, ParticipantBar
```

## Development

```bash
npm start          # Launch with hot reload
npm run lint       # TypeScript + ESLint + dependency boundaries
npm test           # Unit, integration, regression, and component tests
npm run smoke:web      # Browser app Playwright smoke
npm run smoke:desktop  # Electron desktop Playwright smoke
npm run make       # Build NSIS installer + updater metadata
npm run make:forge # Legacy Forge/Squirrel distributable fallback
npm run make:sandbox  # Build + launch Windows Sandbox to test the installer
npm run sandbox       # Launch sandbox using existing out/builder artifacts
```

`make:sandbox` rebuilds chamber, then opens a fresh Windows Sandbox with
`out/builder` mapped read-only to `C:\installer`. Explorer auto-opens to the
NSIS installer so you can simulate a clean first-run install. Requires
Windows Pro/Enterprise/Education with the Windows Sandbox feature enabled.

## License

[MIT](LICENSE)
