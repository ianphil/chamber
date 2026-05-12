import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const MAX_REQUEST_BYTES = 1_000_000;
const DEFAULT_MESSAGE_LEASE_MS = 30_000;
const DEFAULT_MAX_QUEUE_DEPTH = 1_000;

export function createA2ARelayServer({
  token,
  log = console.error,
  leaseMs = DEFAULT_MESSAGE_LEASE_MS,
  maxQueueDepth = DEFAULT_MAX_QUEUE_DEPTH,
}) {
  const registry = new Map();
  const messages = [];
  let server = null;
  let port = 0;

  async function start(requestedPort = 0) {
    if (server?.listening && port) return { port, token };

    server = createServer(async (request, response) => {
      try {
        if (!isAuthorized(request.headers.authorization, token)) {
          return sendJson(response, 401, { error: "unauthorized" });
        }

        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/api/a2a/agents") {
          return sendJson(response, 200, { agents: [...registry.values()] });
        }

        const cardMatch = /^\/api\/a2a\/agents\/([^/]+)\/card$/.exec(url.pathname);
        if (request.method === "GET" && cardMatch) {
          const card = getCard(decodeURIComponent(cardMatch[1]));
          return card
            ? sendJson(response, 200, card)
            : sendJson(response, 404, { error: "agent not found" });
        }

        const agentMatch = /^\/api\/a2a\/agents\/([^/]+)$/.exec(url.pathname);
        if (request.method === "DELETE" && agentMatch) {
          unregisterAgent(decodeURIComponent(agentMatch[1]));
          return sendJson(response, 200, { ok: true });
        }

        if (request.method === "POST" && url.pathname === "/api/a2a/agents") {
          const body = await readJson(request);
          const card = isAgentCard(body?.card) ? body.card : isAgentCard(body) ? body : null;
          if (!card) return sendJson(response, 400, { error: "valid agent card is required" });
          registerAgent(card, isBearerAuth(body?.inboundAuth) ? body.inboundAuth : undefined);
          return sendJson(response, 200, { ok: true, agent: card });
        }

        if (request.method === "POST" && url.pathname === "/api/a2a/messages:poll") {
          const body = await readJson(request);
          if (!isPollRequest(body)) {
            return sendJson(response, 400, { error: "valid A2A poll request is required" });
          }
          return sendJson(response, 200, { messages: pollMessages(body.recipients, body.limit) });
        }

        if (request.method === "POST" && url.pathname === "/api/a2a/messages:ack") {
          const body = await readJson(request);
          if (!isAckRequest(body)) {
            return sendJson(response, 400, { error: "valid A2A ack request is required" });
          }
          return sendJson(response, 200, { acknowledged: ackMessages(body.messageIds) });
        }

        if (request.method === "POST" && (url.pathname === "/api/a2a/message:send" || url.pathname === "/message:send")) {
          const body = await readJson(request);
          if (!isSendMessageRequest(body)) {
            return sendJson(response, 400, { error: "valid A2A SendMessageRequest is required" });
          }
          const result = enqueueMessage(body);
          return sendJson(response, 200, result);
        }

        return sendJson(response, 404, { error: "not found" });
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return sendJson(response, 413, { error: "request body too large" });
        }
        if (error instanceof SyntaxError) {
          return sendJson(response, 400, { error: "request body must be valid JSON" });
        }
        if (error instanceof RelayRequestError) {
          return sendJson(response, error.status, { error: error.message });
        }
        log(`A2A relay request failed: ${error instanceof Error ? error.message : String(error)}`);
        return sendJson(response, 500, { error: "internal server error" });
      }
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(requestedPort, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        port = typeof address === "object" && address ? address.port : requestedPort;
        resolve();
      });
    });
    return { port, token };
  }

  function registerAgent(card, inboundAuth) {
    if (!card.name.trim()) throw new RelayRequestError(400, "agent card name is required");
    registry.set(card.name, card);
  }

  function unregisterAgent(identifier) {
    const card = getCard(identifier);
    if (!card) return;
    registry.delete(card.name);
  }

  function getCard(identifier) {
    if (registry.has(identifier)) return registry.get(identifier);
    const matches = [...registry.values()].filter((card) => getCardIdentifiers(card).includes(identifier));
    if (matches.length > 1) {
      throw new RelayRequestError(409, `recipient is ambiguous: ${identifier}`);
    }
    return matches[0] ?? null;
  }

  function enqueueMessage(request) {
    const card = getCard(request.recipient);
    if (!card) throw new RelayRequestError(404, `agent not found: ${request.recipient}`);
    const recipientIdentifiers = getCardIdentifiers(card);
    if (messages.length >= maxQueueDepth) {
      throw new RelayRequestError(429, "A2A relay message queue is full");
    }
    const entry = {
      id: `relay-msg-${randomUUID()}`,
      recipient: card.name,
      recipientIdentifiers,
      request,
      enqueuedAt: new Date().toISOString(),
      leasedUntil: 0,
      attempts: 0,
    };
    messages.push(entry);
    return {
      queued: true,
      queueMessageId: entry.id,
      message: request.message,
    };
  }

  function pollMessages(recipients, limit = 25) {
    const recipientSet = new Set(recipients);
    const now = Date.now();
    const result = [];
    for (const entry of messages) {
      if (result.length >= Math.max(1, Math.min(limit ?? 25, 100))) break;
      if (entry.leasedUntil > now) continue;
      if (!entry.recipientIdentifiers.some((identifier) => recipientSet.has(identifier))) continue;
      entry.leasedUntil = now + leaseMs;
      entry.attempts += 1;
      result.push({
        id: entry.id,
        recipient: entry.recipient,
        request: entry.request,
        enqueuedAt: entry.enqueuedAt,
        attempts: entry.attempts,
      });
    }
    return result;
  }

  function ackMessages(messageIds) {
    const idSet = new Set(messageIds);
    let acknowledged = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (!idSet.has(messages[index].id)) continue;
      messages.splice(index, 1);
      acknowledged += 1;
    }
    return acknowledged;
  }

  return {
    start,
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
    getPort: () => port,
    getToken: () => token,
    listAgents: () => [...registry.values()],
    listMessages: () => messages.map(({ id, recipient, request, enqueuedAt, leasedUntil, attempts }) => ({
      id,
      recipient,
      request,
      enqueuedAt,
      leasedUntil,
      attempts,
    })),
    registerAgent,
    unregisterAgent,
  };
}

async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) throw new RequestBodyTooLargeError();
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

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/a2a+json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function isAgentCard(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.version === "string" &&
    Array.isArray(value.supportedInterfaces) &&
    Array.isArray(value.defaultInputModes) &&
    Array.isArray(value.defaultOutputModes) &&
    Array.isArray(value.skills) &&
    value.capabilities &&
    typeof value.capabilities === "object",
  );
}

function isBearerAuth(value) {
  return Boolean(value && typeof value === "object" && value.scheme === "bearer" && typeof value.token === "string" && value.token.trim());
}

function isSendMessageRequest(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.recipient === "string" &&
    value.message &&
    typeof value.message === "object" &&
    typeof value.message.messageId === "string" &&
    (value.message.role === "user" || value.message.role === "agent") &&
    Array.isArray(value.message.parts),
  );
}

function isPollRequest(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray(value.recipients) &&
    value.recipients.every((recipient) => typeof recipient === "string" && recipient.trim()) &&
    (value.limit === undefined || (Number.isInteger(value.limit) && value.limit > 0)),
  );
}

function isAckRequest(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray(value.messageIds) &&
    value.messageIds.every((messageId) => typeof messageId === "string" && messageId.trim()),
  );
}

function getCardIdentifiers(card) {
  return [...new Set([
    card.name,
    card.mindId,
    ...(Array.isArray(card.aliases) ? card.aliases : []),
  ].filter((value) => typeof value === "string" && value.trim()))];
}

class RequestBodyTooLargeError extends Error {}

class RelayRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
