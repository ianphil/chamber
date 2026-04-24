# Chamber

Where AI agents are born and operate.

Chamber is a desktop app for AI agents that act as your Chief of Staff — managing priorities, surfacing context, and keeping operations moving. Connect a mind (an agent with memory, skills, and personality) and the agent extends the UI itself: drop a `view.json` into the mind and a new panel appears. No code changes, no deploys.

Built with Electron, React, Tailwind CSS, and the GitHub Copilot SDK. Minds are created with [Genesis](https://github.com/ianphil/genesis).

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
- **Built-in cron** — schedule prompt, process, webhook, and notification jobs per mind without installing per-mind extensions.
- **Activity bar** — VS Code-style icon strip. Icons appear as views are discovered.
- **Streaming chat** — real-time responses with markdown, tool calls, and reasoning blocks.
- **Chatroom** — multi-agent group chat with 5 orchestration modes: Concurrent (all agents respond in parallel), Sequential (round-robin), GroupChat (moderator-directed), Handoff (agent-to-agent delegation), and Magentic (manager-driven task ledger).
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

## Architecture

```
Electron Main Process
├── CopilotClientFactory — per-mind CopilotClient lifecycle
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
npm run lint       # TypeScript + ESLint
npm run make       # Build distributable
```

## License

[MIT](LICENSE)
