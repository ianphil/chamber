// Canvas tools — canvas_show, canvas_update, canvas_close

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { exec } from "node:child_process";

const isWindows = process.platform === "win32";

function openBrowser(url) {
  const cmd = isWindows
    ? `start msedge "${url}"`
    : process.platform === "darwin"
      ? `open -a "Microsoft Edge" "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, { shell: true }, () => {});
}

function writeContent(contentDir, filename, html) {
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true });
  }
  writeFileSync(join(contentDir, filename), html, "utf-8");
}

export function createCanvasTools(contentDir, server, onAction) {
  // Track open canvases: name → { filename, url }
  const openCanvases = new Map();

  return [
    {
      name: "canvas_show",
      description:
        "Display HTML content in the user's browser. Creates a local canvas page and opens it in Edge. " +
        "The HTML can be a full page or a fragment — a bridge script is auto-injected for live reload. " +
        "Use this for dashboards, reports, visualizations, forms, or any rich visual output.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Canvas name (used as identifier). Kebab-case, e.g. 'daily-report', 'pr-dashboard'",
          },
          html: {
            type: "string",
            description: "Full HTML content to display. Can be a complete page or fragment. Not required if 'file' is provided.",
          },
          file: {
            type: "string",
            description: "Absolute path to an existing HTML file to serve. The file is copied into the canvas content directory. Use instead of 'html' to serve a pre-built file.",
          },
          title: {
            type: "string",
            description: "Optional page title. Used if html doesn't include a <title> tag.",
          },
          open_browser: {
            type: "boolean",
            description: "Whether to open the browser. Defaults to true. Set false to update content without opening a new tab.",
          },
        },
        required: ["name"],
      },
      handler: async (args) => {
        if (!args.html && !args.file) {
          return "Error: either 'html' or 'file' must be provided.";
        }

        const filename = `${args.name}.html`;

        if (args.file) {
          // Serve an existing file — copy it into the content directory
          if (!existsSync(args.file)) {
            return `Error: file not found: ${args.file}`;
          }
          const source = readFileSync(args.file, "utf-8");
          writeContent(contentDir, filename, source);
        } else {
          let html = args.html;

          // Wrap fragment in a full page if needed
          if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
            const title = args.title || args.name;
            html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
${html}
</body>
</html>`;
          } else if (args.title && !html.toLowerCase().includes("<title>")) {
            html = html.replace("</head>", `  <title>${args.title}</title>\n</head>`);
          }

          writeContent(contentDir, filename, html);
        }

        // Start server if not running
        let port = server.getPort();
        if (!port) {
          port = await server.start();
        }

        const url = `http://127.0.0.1:${port}/${filename}`;
        openCanvases.set(args.name, { filename, url });

        const shouldOpen = args.open_browser !== false;
        if (shouldOpen) {
          openBrowser(url);
        }

        return `Canvas **${args.name}** is live at ${url}${shouldOpen ? " (opened in Edge)" : ""}`;
      },
    },

    {
      name: "canvas_update",
      description:
        "Update the content of an existing canvas. The browser auto-reloads via SSE — no need to reopen. " +
        "Use this to refresh dashboards, update reports, or push new content to an already-open canvas.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Canvas name to update (must have been created with canvas_show)",
          },
          html: {
            type: "string",
            description: "New HTML content to display",
          },
          title: {
            type: "string",
            description: "Optional updated page title",
          },
        },
        required: ["name", "html"],
      },
      handler: async (args) => {
        const existing = openCanvases.get(args.name);
        if (!existing) {
          return `Error: canvas '${args.name}' not found. Use canvas_show to create it first.`;
        }

        let html = args.html;
        if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
          const title = args.title || args.name;
          html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
${html}
</body>
</html>`;
        }

        writeContent(contentDir, existing.filename, html);
        server.reload();

        return `Canvas **${args.name}** updated. Browser will auto-reload.`;
      },
    },

    {
      name: "canvas_close",
      description:
        "Close a canvas and optionally stop the canvas server. " +
        "Removes the canvas content. If no canvases remain, stops the server.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Canvas name to close. Use 'all' to close all canvases and stop the server.",
          },
        },
        required: ["name"],
      },
      handler: async (args) => {
        if (args.name === "all") {
          const count = openCanvases.size;
          server.closeClients();
          await new Promise((r) => setTimeout(r, 200));
          openCanvases.clear();
          await server.stop();
          return `Closed ${count} canvas(es) and stopped the server.`;
        }

        const existing = openCanvases.get(args.name);
        if (!existing) {
          return `Error: canvas '${args.name}' not found.`;
        }

        server.closeClients();
        await new Promise((r) => setTimeout(r, 200));
        openCanvases.delete(args.name);

        // Stop server if no canvases remain
        if (openCanvases.size === 0) {
          await server.stop();
          return `Canvas **${args.name}** closed. Server stopped (no remaining canvases).`;
        }

        return `Canvas **${args.name}** closed. ${openCanvases.size} canvas(es) still active.`;
      },
    },

    {
      name: "canvas_list",
      description: "List all open canvases with their URLs.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        if (openCanvases.size === 0) {
          return "No canvases are open.";
        }

        const lines = [];
        for (const [name, info] of openCanvases) {
          lines.push(`• **${name}** — ${info.url}`);
        }

        const status = server.isRunning()
          ? `Server running on port ${server.getPort()}`
          : "Server not running";

        return `${lines.join("\n")}\n\n${status}`;
      },
    },
  ];
}
