import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";
import { randomBytes } from "node:crypto";

import { createA2ARelayServer } from "./lib/relay-server.mjs";
import { createA2AServerTools } from "./tools/a2a-server-tools.mjs";

const token = process.env.CHAMBER_A2A_SERVER_TOKEN ?? randomBytes(32).toString("base64url");

const state = {
  token,
  server: createA2ARelayServer({ token }),
};

await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => {
      console.error("a2a-server: extension loaded");
    },
  },
  tools: createA2AServerTools(state),
});
