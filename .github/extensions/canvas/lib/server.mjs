// Canvas server — local HTTP server with SSE live reload and action back-channel.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

/** Bridge script injected into HTML responses. */
const BRIDGE_SCRIPT = `
<script>
(function() {
  // SSE live reload — only reload on explicit "reload" events.
  // EventSource auto-reconnects on errors; no manual reload needed.
  var es = new EventSource('/_sse');
  es.onmessage = function(e) {
    if (e.data === 'reload') { location.reload(); }
    if (e.data === 'close') { window.close(); }
  };

  // Back-channel: canvas pages can send actions to the agent
  window.canvas = {
    sendAction: function(name, data) {
      return fetch('/_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, data: data || {}, timestamp: Date.now() })
      });
    }
  };
})();
</script>`;

/**
 * Create and manage a canvas HTTP server.
 * @param {string} contentDir - Directory to serve files from
 * @param {function} onAction - Callback when a user action is received
 * @returns {object} Server controller
 */
export function createCanvasServer(contentDir, onAction) {
  let server = null;
  let port = null;
  let sseClients = [];

  function handleRequest(req, res) {
    // SSE endpoint
    if (req.url === "/_sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("data: connected\n\n");
      sseClients.push(res);
      req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
      return;
    }

    // Action back-channel
    if (req.url === "/_action" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const action = JSON.parse(body);
          if (onAction) onAction(action);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"invalid json"}');
        }
      });
      return;
    }

    // Static file serving
    let filePath = req.url === "/" ? "/index.html" : req.url;
    filePath = filePath.split("?")[0]; // strip query params
    const fullPath = join(contentDir, filePath);

    // Path traversal protection
    if (!fullPath.startsWith(contentDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    try {
      let content = readFileSync(fullPath);
      const ext = extname(fullPath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";

      // Inject bridge script into HTML responses
      if (ext === ".html") {
        let html = content.toString("utf-8");
        if (html.includes("</body>")) {
          html = html.replace("</body>", `${BRIDGE_SCRIPT}\n</body>`);
        } else if (html.includes("</html>")) {
          html = html.replace("</html>", `${BRIDGE_SCRIPT}\n</html>`);
        } else {
          html += BRIDGE_SCRIPT;
        }
        content = html;
      }

      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  }

  return {
    /** Start the server on a random available port. */
    start() {
      return new Promise((resolve, reject) => {
        if (server) {
          resolve(port);
          return;
        }
        server = createServer(handleRequest);
        server.listen(0, "127.0.0.1", () => {
          port = server.address().port;
          resolve(port);
        });
        server.on("error", reject);
      });
    },

    /** Push an SSE reload event to all connected clients. */
    reload() {
      for (const client of sseClients) {
        try {
          client.write("data: reload\n\n");
        } catch { /* client disconnected */ }
      }
    },

    /** Push an SSE close event to all connected clients. */
    closeClients() {
      for (const client of sseClients) {
        try {
          client.write("data: close\n\n");
        } catch { /* client disconnected */ }
      }
    },

    /** Stop the server. */
    stop() {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        // Close all SSE connections
        for (const client of sseClients) {
          try { client.end(); } catch { /* ok */ }
        }
        sseClients = [];
        server.close(() => {
          server = null;
          port = null;
          resolve();
        });
      });
    },

    /** Get the current port (null if not running). */
    getPort() { return port; },

    /** Check if server is running. */
    isRunning() { return server !== null; },
  };
}
