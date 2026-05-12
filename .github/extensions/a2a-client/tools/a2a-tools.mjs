import { randomUUID } from "node:crypto";

const POLL_INTERVAL_MS = 1_000;

export function createA2ATools(state, hooks) {
  return [
    {
      name: "chamber_a2a_connect",
      description:
        "Connect this Copilot CLI session to an A2A relay and register the CLI agent card.",
      parameters: {
        type: "object",
        properties: {
          base_url: {
            type: "string",
            description: "A2A relay base URL, for example http://127.0.0.1:3210. Defaults to CHAMBER_A2A_URL.",
          },
          token: {
            type: "string",
            description: "A2A relay bearer token. Defaults to CHAMBER_A2A_TOKEN.",
          },
          agent_name: {
            type: "string",
            description: "Optional display name to register for this CLI session.",
          },
        },
      },
      handler: async (args) => {
        await disconnectA2AClient(state);
        updateConnection(state, args);
        const card = createAgentCard(state.agentName);
        const response = await chamberFetch(state, "/api/a2a/agents", {
          method: "POST",
          body: JSON.stringify({ card }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(`A2A relay registration failed: ${body?.error ?? response.statusText}`);
        }
        state.registeredAgentName = card.name;
        startPolling(state, hooks);
        return {
          registered: true,
          agent: card,
          chamber: state.chamberBaseUrl,
          response: body,
        };
      },
    },
    {
      name: "chamber_a2a_list_agents",
      description: "List A2A agent cards currently registered in the connected relay.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const response = await chamberFetch(state, "/api/a2a/agents", { method: "GET" });
        return response.json();
      },
    },
    {
      name: "chamber_a2a_send_message",
      description: "Send a message from this Copilot CLI session to another registered A2A agent.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Target A2A agent id or unique agent name.",
          },
          message: {
            type: "string",
            description: "Plain text message to send.",
          },
          context_id: {
            type: "string",
            description: "Optional A2A contextId for continuing a conversation.",
          },
        },
        required: ["recipient", "message"],
      },
      handler: async (args) => {
        return sendA2AMessage(state, args);
      },
    },
    {
      name: "chamber_a2a_read_messages",
      description:
        "Read inbound A2A messages received by this Copilot CLI session. Use this to notice questions from Chamber agents and continue the conversation with the same contextId.",
      parameters: {
        type: "object",
        properties: {
          unread_only: {
            type: "boolean",
            description: "Only return unread messages. Defaults to true.",
          },
          mark_read: {
            type: "boolean",
            description: "Mark returned messages as read. Defaults to true.",
          },
        },
      },
      handler: async (args) => {
        const unreadOnly = args.unread_only !== false;
        const markRead = args.mark_read !== false;
        const messages = state.inbox.filter((entry) => !unreadOnly || !entry.read);
        if (markRead) {
          for (const entry of messages) {
            entry.read = true;
          }
        }
        return { messages };
      },
    },
    {
      name: "chamber_a2a_reply",
      description:
        "Reply to an inbound A2A message. Defaults to the original sender and preserves that message's contextId for multi-turn conversation continuity.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Inbound A2A messageId to reply to. Defaults to the latest inbound message.",
          },
          recipient: {
            type: "string",
            description: "Override target A2A agent id or name. Defaults to the inbound message sender id.",
          },
          message: {
            type: "string",
            description: "Plain text reply to send.",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const source = findReplySource(state.inbox, args.message_id);
        const recipient = args.recipient ?? source?.sender?.id;
        if (!recipient) {
          throw new Error("No inbound A2A message is available to infer a reply recipient.");
        }
        return sendA2AMessage(state, {
          recipient,
          message: args.message,
          context_id: source?.contextId,
        });
      },
    },
  ];
}

export async function disconnectA2AClient(state) {
  stopPolling(state);
  const registeredAgentName = state.registeredAgentName;
  state.registeredAgentName = null;
  if (!registeredAgentName || !state.chamberBaseUrl || !state.chamberToken) return;

  const response = await chamberFetch(state, `/api/a2a/agents/${encodeURIComponent(registeredAgentName)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => null);
    throw new Error(`A2A relay unregister failed: ${body?.error ?? response.statusText}`);
  }
}

async function sendA2AMessage(state, args) {
  const request = {
    recipient: args.recipient,
    message: {
      messageId: `msg-${randomUUID()}`,
      contextId: args.context_id,
      role: "user",
      parts: [{ text: args.message, mediaType: "text/plain" }],
      metadata: { fromName: state.agentName, fromId: state.agentName },
    },
    configuration: { returnImmediately: true },
  };
  const response = await chamberFetch(state, "/api/a2a/message:send", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return response.json();
}

function findReplySource(inbox, messageId) {
  if (messageId) {
    return inbox.find((entry) => entry.id === messageId) ?? null;
  }
  return inbox.at(-1) ?? null;
}

function startPolling(state, hooks) {
  if (state.pollTimer) return;
  const poll = async () => {
    try {
      await pollA2AMessages(state, hooks);
    } catch (error) {
      state.session?.log(`A2A relay poll failed: ${error instanceof Error ? error.message : String(error)}`, {
        level: "error",
        ephemeral: true,
      });
    } finally {
      state.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  state.pollTimer = setTimeout(poll, 0);
}

export async function pollA2AMessages(state, hooks) {
  const response = await chamberFetch(state, "/api/a2a/messages:poll", {
    method: "POST",
    body: JSON.stringify({ recipients: [state.agentName], limit: 25 }),
  });
  const body = await response.json();
  let firstDeliveryError = null;
  for (const queuedMessage of Array.isArray(body.messages) ? body.messages : []) {
    if (!queuedMessage?.id || !queuedMessage.request) continue;
    try {
      hooks.onMessage(queuedMessage.request);
      await chamberFetch(state, "/api/a2a/messages:ack", {
        method: "POST",
        body: JSON.stringify({ messageIds: [queuedMessage.id] }),
      });
    } catch (error) {
      firstDeliveryError ??= error;
    }
  }
  if (firstDeliveryError) {
    throw firstDeliveryError;
  }
}

function stopPolling(state) {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

function updateConnection(state, args) {
  if (typeof args.base_url === "string" && args.base_url.trim()) {
    state.chamberBaseUrl = args.base_url.trim().replace(/\/$/, "");
  }
  if (typeof args.token === "string" && args.token.trim()) {
    state.chamberToken = args.token.trim();
  }
  if (typeof args.agent_name === "string" && args.agent_name.trim()) {
    state.agentName = args.agent_name.trim();
  }
}

function createAgentCard(name) {
  return {
    name,
    description: "A Copilot CLI session available for message-only A2A conversation.",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: "relay:mailbox",
        protocolBinding: "A2A_RELAY_MAILBOX",
        protocolVersion: "1.0",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "conversation",
        name: "Conversation",
        description: "Receives A2A text messages into the active Copilot CLI session.",
        tags: ["a2a", "conversation"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  };
}

async function chamberFetch(state, path, options) {
  if (!state.chamberBaseUrl) {
    throw new Error("A2A relay base URL is not configured. Run chamber_a2a_connect with base_url first.");
  }
  if (!state.chamberToken) {
    throw new Error("A2A relay token is not configured. Run chamber_a2a_connect with token first.");
  }
  const response = await fetch(`${state.chamberBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${state.chamberToken}`,
      origin: "http://127.0.0.1",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chamber A2A request failed with HTTP ${response.status}: ${text}`);
  }
  return response;
}
