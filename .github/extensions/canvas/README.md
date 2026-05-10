# Canvas Extension

A Copilot CLI extension that lets agents display rich HTML content in the browser. Write a dashboard, render a report, or build an interactive form ...  the agent generates HTML and it appears in Edge with live reload.

## Setup

After cloning or installing this extension, install npm dependencies (if any are added later):

```bash
cd .github/extensions/canvas && npm install --no-fund --no-audit
```

> **Note:** The Copilot CLI does not auto-install npm dependencies for extensions. Canvas currently has zero dependencies, but run this if the extension fails to load after adding packages.

## Quick Example

> "Show me a visual summary of my open PRs"

The agent generates an HTML dashboard and opens it in your browser:

```
canvas_show:
  name: pr-dashboard
  html: "<h1>Open PRs</h1><div class='grid'>..."
```

Update it without opening a new tab:

```
canvas_update:
  name: pr-dashboard
  html: "<h1>Open PRs (refreshed)</h1>..."
```

The browser auto-reloads ...  no manual refresh needed.

## How It Works

1. Agent calls `canvas_show` with HTML content
2. Extension writes the HTML and starts a local HTTP server
3. A bridge script is auto-injected for SSE live reload
4. Edge opens to `http://127.0.0.1:{port}/canvas-name.html`
5. Agent calls `canvas_update` → server pushes SSE → browser reloads

No websockets. SSE for push, HTTP POST for back-channel.

## Tools

| Tool | Description |
|------|-------------|
| `canvas_show` | Create a canvas and open it in the browser |
| `canvas_update` | Update an existing canvas (auto-reloads via SSE) |
| `canvas_close` | Close a canvas; stops server if none remain |
| `canvas_list` | List all open canvases with URLs |

## Back-Channel (Browser → Agent)

Canvas pages can send actions back to the agent using the injected bridge:

```js
// Inside your canvas HTML
canvas.sendAction("button-clicked", { id: "approve", value: true });
```

This POSTs to the extension's local server, which routes it into the agent session.

## File Structure

```
.github/extensions/canvas/
├── extension.mjs           # Entry point
├── lib/
│   └── server.mjs          # HTTP server + SSE + action endpoint
├── tools/
│   └── canvas-tools.mjs    # canvas_show, canvas_update, canvas_close, canvas_list
├── data/
│   └── content/            # Served HTML files (gitignored)
└── package.json
```

## Notes

- HTML fragments are auto-wrapped in a full page with viewport meta tag
- All served HTML gets the bridge script injected before `</body>`
- Server binds to `127.0.0.1` only ...  not exposed to the network
- No dependencies ...  uses Node.js built-in `http` module
- Cache headers set to `no-store` so the browser always gets fresh content
