import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const POLL_INTERVAL_MS = 1_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

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
          auth_mode: {
            type: "string",
            enum: ["auto", "static", "interactive"],
            description: "Authentication mode. Defaults to static when a token is present, otherwise interactive when a client ID is configured.",
          },
          client_id: {
            type: "string",
            description: "Entra app client ID for interactive cloud login. Defaults to SWITCHBOARD_AUTH_CLIENT_ID or CHAMBER_A2A_CLIENT_ID.",
          },
          tenant_id: {
            type: "string",
            description: "Entra tenant for interactive login. Defaults to CHAMBER_A2A_TENANT_ID or common.",
          },
          scope: {
            type: "string",
            description: "OAuth scope for the Switchboard API. Defaults to api://<client_id>/user_impersonation.",
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
        const card = createAgentCard(state.agentName, state.chamberBaseUrl);
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
  if (!registeredAgentName || !state.chamberBaseUrl || !hasRelayAuth(state)) return;

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
      role: "ROLE_USER",
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
  if (typeof args.auth_mode === "string" && args.auth_mode.trim()) {
    state.authMode = args.auth_mode.trim();
  }
  if (typeof args.client_id === "string" && args.client_id.trim()) {
    state.entraClientId = args.client_id.trim();
  }
  if (typeof args.tenant_id === "string" && args.tenant_id.trim()) {
    state.entraTenantId = args.tenant_id.trim();
  }
  if (typeof args.scope === "string" && args.scope.trim()) {
    state.entraScope = args.scope.trim();
  }
  if (typeof args.agent_name === "string" && args.agent_name.trim()) {
    state.agentName = args.agent_name.trim();
  }
}

function createAgentCard(name, relayBaseUrl) {
  return {
    name,
    description:
      "Chamber Copilot CLI for the Chamber repo. If this agent is available and you need to inspect, change, test, or coordinate work in Chamber, route that request here.",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: new URL("/message:send", relayBaseUrl).toString(),
        protocolBinding: "https://github.com/ianphil/chamber/a2a/bindings/relay-mailbox/v1",
        protocolVersion: "1.0",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "conversation",
        name: "Chamber repo coordination",
        description:
          "Send Chamber engineering questions or work requests here when this agent is available; it has the active Chamber workspace context.",
        tags: ["a2a", "conversation", "chamber", "repo"],
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
  const authorization = await getAuthorizationHeader(state);
  const response = await fetch(`${state.chamberBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization,
      "A2A-Version": "1.0",
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

function hasRelayAuth(state) {
  return Boolean(state.chamberToken || state.accessToken || state.refreshToken || state.entraClientId);
}

async function getAuthorizationHeader(state) {
  if (selectAuthMode(state) === "static") {
    if (!state.chamberToken) {
      throw new Error("A2A relay token is not configured. Run chamber_a2a_connect with token first.");
    }
    return `Bearer ${state.chamberToken}`;
  }

  const accessToken = await ensureAccessToken(state);
  return `Bearer ${accessToken}`;
}

function selectAuthMode(state) {
  if (state.authMode && state.authMode !== "auto") return state.authMode;
  return state.chamberToken ? "static" : "interactive";
}

async function ensureAccessToken(state) {
  const now = Date.now();
  if (state.accessToken && state.accessTokenExpiresAt && state.accessTokenExpiresAt - now > TOKEN_REFRESH_SKEW_MS) {
    return state.accessToken;
  }
  if (state.tokenRequest) {
    return state.tokenRequest;
  }

  state.tokenRequest = (async () => {
    try {
      if (state.refreshToken) {
        try {
          return await refreshAccessToken(state);
        } catch (error) {
          state.session?.log(`A2A token refresh failed, starting interactive login: ${error instanceof Error ? error.message : String(error)}`, {
            level: "warning",
            ephemeral: true,
          });
        }
      }
      return await interactiveLogin(state);
    } finally {
      state.tokenRequest = null;
    }
  })();

  return state.tokenRequest;
}

async function interactiveLogin(state) {
  const clientId = getClientId(state);
  const tenantId = state.entraTenantId || process.env.CHAMBER_A2A_TENANT_ID || "common";
  const scope = state.entraScope || `api://${clientId}/user_impersonation`;
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const loginState = base64Url(randomBytes(24));
  const callback = await waitForAuthCode(loginState);
  const redirectUri = `http://localhost:${callback.port}`;
  const authorizeUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", `openid profile offline_access ${scope}`);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", loginState);

  state.session?.log(`Opening browser for Switchboard login: ${authorizeUrl.toString()}`, { ephemeral: false });
  await openBrowser(authorizeUrl.toString());
  const code = await callback.code;
  const token = await exchangeToken(tenantId, {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: `openid profile offline_access ${scope}`,
  });
  applyTokenResponse(state, token);
  return state.accessToken;
}

async function refreshAccessToken(state) {
  const clientId = getClientId(state);
  const tenantId = state.entraTenantId || process.env.CHAMBER_A2A_TENANT_ID || "common";
  const scope = state.entraScope || `api://${clientId}/user_impersonation`;
  const token = await exchangeToken(tenantId, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    scope: `openid profile offline_access ${scope}`,
  });
  applyTokenResponse(state, token);
  return state.accessToken;
}

function getClientId(state) {
  const clientId = state.entraClientId || process.env.SWITCHBOARD_AUTH_CLIENT_ID || process.env.CHAMBER_A2A_CLIENT_ID;
  if (!clientId) {
    throw new Error("Interactive A2A login requires client_id, SWITCHBOARD_AUTH_CLIENT_ID, or CHAMBER_A2A_CLIENT_ID.");
  }
  return clientId;
}

function waitForAuthCode(expectedState) {
  let server;
  let timeout;
  const code = new Promise((resolve, reject) => {
    server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== "/" && url.pathname !== "/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== expectedState) {
          response.writeHead(400).end("Invalid state");
          reject(new Error("Interactive A2A login returned an invalid state."));
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          response.writeHead(400).end("Login failed. You can close this tab.");
          reject(new Error(`${error}: ${url.searchParams.get("error_description") ?? "login failed"}`));
          return;
        }
        const authorizationCode = url.searchParams.get("code");
        if (!authorizationCode) {
          response.writeHead(400).end("Missing code");
          reject(new Error("Interactive A2A login did not return an authorization code."));
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Switchboard login complete</title><p>Switchboard login complete. You can close this tab.</p>");
        resolve(authorizationCode);
      } finally {
        clearTimeout(timeout);
        server.close();
      }
    });
    server.once("error", reject);
    timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for interactive A2A login."));
    }, 120_000);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "localhost", () => {
      const address = server.address();
      resolve({ port: typeof address === "object" && address ? address.port : 0, code });
    });
    server.once("error", reject);
  });
}

async function exchangeToken(tenantId, form) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await response.json().catch(async () => ({ error_description: await response.text() }));
  if (!response.ok) {
    throw new Error(`Switchboard token request failed: ${body.error_description ?? body.error ?? response.statusText}`);
  }
  return body;
}

function applyTokenResponse(state, token) {
  state.accessToken = token.access_token;
  state.refreshToken = token.refresh_token ?? state.refreshToken;
  state.accessTokenExpiresAt = Date.now() + Number(token.expires_in ?? 3600) * 1000;
  if (!state.accessToken) {
    throw new Error("Switchboard token response did not include an access token.");
  }
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  return new Promise((resolve) => {
    execFile(command, args, () => resolve());
  });
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
