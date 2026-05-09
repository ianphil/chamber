import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export function createA2AServer({ getAgentName, onMessage }) {
  let server = null;
  let port = 0;

  async function start() {
    if (server?.listening && port) return port;

    server = createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url === "/agent-card") {
          return sendJson(response, 200, createAgentCard(getAgentName(), port));
        }

        if (request.method === "POST" && (request.url === "/message:send" || request.url === "/a2a/message:send")) {
          const body = await readJson(request);
          if (!isSendMessageRequest(body)) {
            return sendJson(response, 400, { error: "valid A2A SendMessageRequest is required" });
          }
          const entry = onMessage(body);
          return sendJson(response, 200, {
            message: {
              messageId: `msg-${randomUUID()}`,
              contextId: body.message.contextId,
              role: "agent",
              parts: [{ text: "Message queued for Copilot CLI.", mediaType: "text/plain" }],
              metadata: { fromName: getAgentName(), queuedMessageId: entry?.id },
            },
          });
        }

        return sendJson(response, 404, { error: "not found" });
      } catch (error) {
        return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        port = typeof address === "object" && address ? address.port : 0;
        server.off("error", reject);
        resolve();
      });
    });

    return port;
  }

  return {
    start,
    getPort: () => port,
    getAgentCard: async () => createAgentCard(getAgentName(), await start()),
  };
}

function createAgentCard(name, serverPort) {
  return {
    name,
    description: "A Copilot CLI session available for message-only A2A conversation.",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: `http://127.0.0.1:${serverPort}/a2a`,
        protocolBinding: "HTTP+JSON",
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/a2a+json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function isSendMessageRequest(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.recipient === "string" &&
    value.message &&
    typeof value.message === "object" &&
    typeof value.message.messageId === "string" &&
    (value.message.role === "user" || value.message.role === "agent") &&
    Array.isArray(value.message.parts)
  );
}
