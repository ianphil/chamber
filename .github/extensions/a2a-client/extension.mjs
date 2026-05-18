import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

import { createA2ATools, defaultAgentName, disconnectA2AClient } from "./tools/a2a-tools.mjs";

const state = {
  chamberBaseUrl: process.env.CHAMBER_A2A_URL ?? "",
  chamberToken: process.env.CHAMBER_A2A_TOKEN ?? "",
  authMode: process.env.CHAMBER_A2A_AUTH_MODE ?? "auto",
  entraClientId: process.env.SWITCHBOARD_AUTH_CLIENT_ID ?? process.env.CHAMBER_A2A_CLIENT_ID ?? "",
  entraTenantId: process.env.CHAMBER_A2A_TENANT_ID ?? "common",
  entraScope: process.env.CHAMBER_A2A_SCOPE ?? "",
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: 0,
  tokenRequest: null,
  agentName: process.env.CHAMBER_A2A_AGENT_NAME?.trim() || defaultAgentName(),
  entraLoginHint: process.env.CHAMBER_A2A_LOGIN_HINT ?? process.env.SWITCHBOARD_LOGIN_HINT ?? "",
  entraDomainHint: process.env.CHAMBER_A2A_DOMAIN_HINT ?? process.env.SWITCHBOARD_DOMAIN_HINT ?? "",
  registeredAgentName: null,
  inbox: [],
  session: null,
};

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => {
      console.error("a2a-client: extension loaded");
    },
  },
  tools: createA2ATools(state, {
    onMessage: (payload) => {
      const fromName = payload.message?.metadata?.fromName ?? payload.message?.metadata?.fromId ?? "A2A peer";
      const fromId = payload.message?.metadata?.fromId ?? fromName;
      const text = payload.message?.parts?.find((part) => typeof part.text === "string")?.text ?? "";
      const entry = {
        id: payload.message.messageId,
        receivedAt: new Date().toISOString(),
        read: false,
        recipient: payload.recipient,
        sender: {
          id: typeof fromId === "string" ? fromId : String(fromId),
          name: typeof fromName === "string" ? fromName : String(fromName),
        },
        contextId: payload.message.contextId,
        taskId: payload.message.taskId,
        text,
        message: payload.message,
      };
      if (!state.inbox.some((existing) => existing.id === entry.id)) {
        state.inbox.push(entry);
        deliverToCopilotSession(entry);
      }
      return entry;
    },
  }),
});

state.session = session;
registerCleanupHandlers(state);

function deliverToCopilotSession(entry) {
  if (!state.session) return;
  const contextLine = entry.contextId
    ? `Continue A2A contextId ${entry.contextId}.`
    : "This inbound A2A message did not include a contextId.";
  const prompt = `<a2a-inbound-message message-id="${escapeXml(entry.id)}" from-id="${escapeXml(entry.sender.id)}" from-name="${escapeXml(entry.sender.name)}" context-id="${escapeXml(entry.contextId ?? "")}">
  <content>${escapeXml(entry.text)}</content>
</a2a-inbound-message>

${contextLine}
Treat this as a real incoming message from another A2A agent. If it asks a question or expects a response, reply by calling a2a_send_agent_message with reply_to_message_id "${entry.id}" so the same A2A contextId is preserved.`;

  state.session.send({ prompt }).catch((error) => {
    state.session?.log(`A2A delivery failed: ${error instanceof Error ? error.message : String(error)}`, {
      level: "error",
      ephemeral: false,
    });
  });
}

function registerCleanupHandlers(connectionState) {
  const cleanup = async () => {
    await disconnectA2AClient(connectionState).catch((error) => {
      connectionState.session?.log(`A2A relay cleanup failed: ${error instanceof Error ? error.message : String(error)}`, {
        level: "error",
        ephemeral: true,
      });
    });
  };
  process.once("beforeExit", () => {
    void cleanup();
  });
  process.once("SIGTERM", () => {
    const timeout = setTimeout(() => process.exit(0), 500);
    void cleanup().finally(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
