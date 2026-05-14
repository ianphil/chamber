import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const MAX_REQUEST_BYTES = 1_000_000;

export function createA2AServer({ getAgentName, getInboundToken, onMessage, log = console.error }) {
  let server = null;
  let port = 0;

  async function start() {
    if (server?.listening && port) return port;

    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/agent-card") {
          return sendJson(response, 200, createAgentCard(getAgentName(), port));
        }

        if (request.method === "POST" && (url.pathname === "/message:send" || url.pathname === "/a2a/message:send")) {
          if (!isAuthorized(request.headers.authorization, getInboundToken())) {
            return sendJson(response, 401, { error: "unauthorized" });
          }
          const body = await readJson(request);
          if (!isSendMessageRequest(body)) {
            return sendJson(response, 400, { error: "valid A2A SendMessageRequest is required" });
          }
          const entry = onMessage(body);
          return sendJson(response, 200, {
            message: {
              messageId: `msg-${randomUUID()}`,
              contextId: body.message.contextId,
              role: "ROLE_AGENT",
              parts: [{ text: "Message queued for Copilot CLI.", mediaType: "text/plain" }],
              metadata: { fromName: getAgentName(), queuedMessageId: entry?.id },
            },
          });
        }

        return sendJson(response, 404, { error: "not found" });
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return sendJson(response, 413, { error: "request body too large" });
        }
        if (error instanceof SyntaxError) {
          return sendJson(response, 400, { error: "request body must be valid JSON" });
        }
        log(`A2A loopback request failed: ${error instanceof Error ? error.message : String(error)}`);
        return sendJson(response, 500, { error: "internal server error" });
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
    getInboundAuth: () => ({ scheme: "bearer", token: getInboundToken() }),
    stop: () => new Promise((resolve) => {
      if (!server?.listening) {
        server = null;
        port = 0;
        resolve();
        return;
      }
      server.close(() => {
        server = null;
        port = 0;
        resolve();
      });
    }),
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
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

function isAuthorized(authorizationHeader, token) {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorizationHeader.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

class RequestBodyTooLargeError extends Error {}

function sendJson(response, status, body) {
  response.writeHead(status, {
        "content-type": "application/a2a+json; charset=utf-8",
        "A2A-Version": "1.0",
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
    (value.message.role === "ROLE_USER" || value.message.role === "ROLE_AGENT") &&
    Array.isArray(value.message.parts)
  );
}
