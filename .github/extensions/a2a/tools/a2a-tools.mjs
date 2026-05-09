import { randomUUID } from "node:crypto";

export function createA2ATools(state, server) {
  return [
    {
      name: "chamber_a2a_connect",
      description:
        "Connect this Copilot CLI session to Chamber's loopback A2A API and register the CLI agent card.",
      parameters: {
        type: "object",
        properties: {
          base_url: {
            type: "string",
            description: "Chamber server base URL, for example http://127.0.0.1:3210. Defaults to CHAMBER_A2A_URL.",
          },
          token: {
            type: "string",
            description: "Chamber server bearer token. Defaults to CHAMBER_A2A_TOKEN.",
          },
          agent_name: {
            type: "string",
            description: "Optional display name to register for this CLI session.",
          },
        },
      },
      handler: async (args) => {
        updateConnection(state, args);
        const card = await server.getAgentCard();
        const response = await chamberFetch(state, "/api/a2a/agents", {
          method: "POST",
          body: JSON.stringify({ card, inboundAuth: server.getInboundAuth() }),
        });
        return {
          registered: response.ok,
          agent: card,
          chamber: state.chamberBaseUrl,
          response: await response.json(),
        };
      },
    },
    {
      name: "chamber_a2a_list_agents",
      description: "List A2A agent cards currently registered in Chamber.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const response = await chamberFetch(state, "/api/a2a/agents", { method: "GET" });
        return response.json();
      },
    },
    {
      name: "chamber_a2a_send_message",
      description: "Send a message from this Copilot CLI session to a Chamber mind via A2A.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Target Chamber mindId or unique agent name.",
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
            description: "Override target Chamber mindId or name. Defaults to the inbound message sender id.",
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

async function chamberFetch(state, path, options) {
  if (!state.chamberBaseUrl) {
    throw new Error("Chamber base URL is not configured. Run chamber_a2a_connect with base_url first.");
  }
  if (!state.chamberToken) {
    throw new Error("Chamber token is not configured. Run chamber_a2a_connect with token first.");
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
