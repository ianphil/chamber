# Genesis UI

Desktop chat interface for [Genesis](https://github.com/ianphil/genesis) minds.

Built with Electron, React, Tailwind CSS, and the GitHub Copilot SDK.

## Quick Start

**Prerequisites:**

- [Node.js](https://nodejs.org/) 20+
- [GitHub Copilot CLI](https://github.com/githubnext/copilot-cli) installed and on PATH
- `@github/copilot-sdk` installed globally: `npm install -g @github/copilot-sdk`

**Run:**

```bash
git clone https://github.com/ianphil/genesis-ui
cd genesis-ui
npm install
npm start
```

Select a Genesis mind directory from the sidebar, then start chatting.

## Features

- **Streaming chat** — real-time token-by-token responses with markdown rendering
- **Embedded Copilot SDK** — the app *is* the agent session, no separate server needed
- **Mind directory selector** — point at any Genesis mind to chat with it
- **Dark theme** — clean, minimal UI designed for demos

## Architecture

```
Electron Main Process
├── SdkLoader — loads @github/copilot-sdk, manages singleton CopilotClient
├── ChatService — session lifecycle, streaming deltas, abort
└── IPC Handlers — chat:send/chunk/done/error, agent:status/config

Preload Bridge (contextBridge)
└── window.electronAPI — narrow typed API surface

React Renderer
├── Chat panel — MessageList, ChatInput, StreamingMessage
├── Sidebar — connection status, mind selector, new conversation
└── Welcome screen — starter prompts for demos
```

## Development

```bash
npm start          # Launch with hot reload
npm run lint       # ESLint
npm run make       # Build distributable
```

## License

[MIT](LICENSE)
