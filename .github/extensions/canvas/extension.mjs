// Canvas Extension — Entry Point
// Registers canvas tools with the Copilot CLI session.
// Provides a local HTTP server for displaying HTML canvases in the browser.

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

import { createCanvasServer } from "./lib/server.mjs";
import { createCanvasTools } from "./tools/canvas-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname);
const contentDir = join(extDir, "data", "content");

// Action queue — user actions from the browser are stored here
// and can be consumed by the agent via session events
const actionQueue = [];

function onAction(action) {
  actionQueue.push(action);
  // Log to session if available
  if (currentSession) {
    currentSession.log(`Canvas action: ${action.action}`, { ephemeral: true });
  }
}

const server = createCanvasServer(contentDir, onAction);

let currentSession = null;

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => {
      console.error("canvas: extension loaded");
    },
  },
  tools: createCanvasTools(contentDir, server, onAction),
});

currentSession = session;
