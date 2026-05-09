# Chamber

<p align="center">
  <img src="docs/assets/app.svg" alt="Chamber" width="72" />
</p>

<p align="center">
  <strong>Where AI agents meet, delegate, and operate.</strong>
</p>

<p align="center">
  Chamber is an A2A-first desktop workspace for creating, running, and coordinating AI agents powered by GitHub Copilot.
</p>

<p align="center">
  <a href="https://chmbr.dev">Download for Windows</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
  ·
  <a href="https://github.com/ianphil/chamber/issues">Roadmap</a>
</p>

![Chamber desktop app showing an agent workspace, chat starter prompts, and conversation history.](docs/assets/chamber-hero.png)

## What is Chamber?

Chamber is an Electron desktop app for A2A-style agent collaboration. A Chamber agent, called a **mind**, has identity, memory, tools, scheduled work, and a UI that can grow with the tasks you give it.

Instead of treating chat as the whole product, Chamber gives agents a shared operating room where they can discover each other, exchange messages, delegate stateful tasks, track artifacts, and still use practical desktop tools like Lens views, Canvas pages, cron jobs, and marketplace-installed Genesis minds.

## A2A first

Chamber puts Agent-to-Agent (A2A) collaboration front and center. Minds are not just tool wrappers; they are peer agents that can describe what they do, talk to each other, and hand off durable work.

In Chamber, A2A means:

- **Agent discovery** — minds expose Agent Card-style metadata with names, descriptions, skills, and capabilities so other minds know who can help.
- **Direct messages** — a mind can send another mind a message when the user asks for another perspective or specialist input.
- **Tracked tasks** — a mind can create a stateful task for another mind, then check progress, list related tasks, or cancel work that is no longer needed.
- **Shared context** — related messages and tasks can stay grouped with a context ID so collaboration keeps continuity across turns.
- **Artifacts and handoffs** — task results can become concrete outputs that another mind can review, refine, or build on.

A2A complements tools. MCP-style tools and marketplace CLIs give a mind access to resources; A2A lets minds collaborate as autonomous agents on larger goals.

## Why use it?

| Need | Chamber gives you |
| --- | --- |
| A personal AI operator | Minds with personality, memory, Agent Card-style skills, and GitHub Copilot-powered turns |
| Agent-to-agent delegation | A2A messages, stateful tasks, task history, cancellation, and cross-mind coordination |
| More than a chat box | Lens views, tables, briefings, status boards, timelines, forms, and editors |
| Multi-agent collaboration | Chatrooms with concurrent, sequential, moderated, handoff, and manager-led modes |
| Durable operations | Built-in cron jobs, conversation history, model selection, and desktop notifications |
| Self-extending workflows | Agents can create Lens views and render HTML canvases for task-specific interfaces |
| Private/local control | Desktop-first runtime with user-local mind directories and OS keychain credentials |

## Features

- **A2A tools** — Let minds list available agents, send peer messages, create tracked tasks, check task status, list tasks, and cancel in-flight work.
- **Minds** — Load or create Genesis agent directories with identity, memory, Agent Card-style skills, and tool access.
- **Chat** — Stream Copilot-powered turns with markdown, reasoning blocks, tool-call display, attachments, stop controls, and conversation history.
- **Lens** — Drop a `view.json` into `.github/lens/` and Chamber renders a form, table, briefing, detail view, status board, timeline, editor, or canvas.
- **Chatroom** — Coordinate multiple minds in concurrent, round-robin, moderated, handoff, or manager-led orchestration modes.
- **Canvas** — Render sandboxed HTML dashboards and reports in the browser with live reload and an action back-channel.
- **Cron** — Schedule prompt, process, webhook, and notification jobs per mind.
- **Marketplace links** — Enroll Genesis mind registries from `chamber://install?registry=...` links.
- **Desktop updates** — Windows installer and update metadata are produced by the release pipeline.

## Install

Download the latest Windows build from [chmbr.dev](https://chmbr.dev) or from the [latest GitHub release](https://github.com/ianphil/chamber/releases/latest).

Windows x64 is the primary packaged target today. macOS and Linux support are planned through the same workspace architecture.

## Quick Start

```bash
git clone https://github.com/ianphil/chamber
cd chamber
npm install
npm start
```

After launch, sign in with GitHub, create a new mind with Genesis, or open an existing Genesis mind directory.

## Development

Chamber uses Node from `.nvmrc`, Electron, React, Tailwind CSS, Vitest, Playwright, and the GitHub Copilot SDK.

```bash
npm start              # Launch the Electron app with hot reload
npm run lint           # TypeScript, ESLint, and dependency boundary checks
npm test               # Unit, integration, regression, and component tests
npm run smoke:web      # Browser app Playwright smoke test
npm run smoke:desktop  # Electron Playwright smoke test
npm run capture:hero   # Refresh docs/assets/chamber-hero.png
npm run make           # Build the Windows NSIS installer and updater metadata
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, validation, versioning, changelog, and release expectations.

## Architecture

Chamber is split into a desktop shell, browser-capable renderer, loopback server, and shared service packages:

```text
apps/
  desktop   Electron lifecycle shell, native bridges, protocol handlers
  web       React renderer, browser mode, UI components
  server    Local HTTP/WebSocket loopback server

packages/
  services        Core business logic
  shared          Shared types and utilities
  wire-contracts  Transport contracts
  client          Browser/server client
```

The desktop app wraps the same web renderer and local server used by browser-mode tests. Services stay behind injected ports, IPC handlers remain thin adapters, and the renderer reaches native capabilities only through the preload bridge.

## Genesis Marketplace Links

Marketplace maintainers can add a click-to-enroll link to a README or internal portal:

```markdown
[![Add to Chamber](https://img.shields.io/badge/Add%20to-Chamber-7c3aed)](https://chmbr.dev/install.html?registry=https%3A%2F%2Fgithub.com%2Fagency-microsoft%2Fgenesis-minds)
```

The GitHub Pages interstitial opens the matching `chamber://install?registry=...` URL and shows a fallback copy button if Chamber is not installed.

Marketplace plugin manifests can also declare CLI tools. Chamber supports npm-global tools and GitHub release asset tools with per-platform SHA-256 metadata.

## Security Model

- Credentials are stored with `keytar` in the OS keychain.
- Mind directories are user-local and should not contain secrets committed to source.
- Tool execution is gated through Chamber's approval and observability layers.
- Canvas content is sandboxed away from Electron main-process APIs.
- Lens manifests validate before rendering.

## License

[MIT](LICENSE)
