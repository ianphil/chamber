import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const POLL_INTERVAL_MS = 1_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const A2A_RELAY_CREDENTIAL_SERVICE = "chamber-a2a-relay";
const A2A_RELAY_ENTRA_CREDENTIAL_SERVICE = "chamber-a2a-relay-entra";

export function createA2ATools(state, hooks) {
  return [
    {
      name: "a2a_connection",
      description:
        "Manage this Copilot CLI session's A2A relay connection: connect, disconnect, or report status.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["connect", "disconnect", "status"],
            description: "Connection action. Defaults to connect.",
          },
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
            description: "Optional display name to register for this CLI session. Defaults to {user}-copilot-{repo}-{host_os}.",
          },
          login_hint: {
            type: "string",
            description: "Optional Entra login_hint (UPN). Prefer domain_hint for shared repos. Defaults to CHAMBER_A2A_LOGIN_HINT or SWITCHBOARD_LOGIN_HINT.",
          },
          domain_hint: {
            type: "string",
            description: "Optional Entra domain_hint (tenant domain) so any contributor in that domain can sign in. Defaults to CHAMBER_A2A_DOMAIN_HINT or SWITCHBOARD_DOMAIN_HINT.",
          },
        },
      },
      handler: async (args) => {
        const action = args.action ?? "connect";
        if (action === "disconnect") {
          await disconnectA2AClient(state);
          return connectionStatus(state);
        }
        if (action === "status") {
          return connectionStatus(state);
        }
        await disconnectA2AClient(state);
        const connectionUpdate = updateConnection(state, args);
        await prepareRelayAuth(state, connectionUpdate);
        const card = createAgentCard(state.agentName, state.chamberBaseUrl);
        const response = await chamberFetch(state, "/api/a2a/agents", {
          method: "POST",
          body: JSON.stringify({ card }),
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(`A2A relay registration failed: ${body?.error ?? response.statusText}`);
        }
        if (connectionUpdate.staticTokenFromArgument) {
          await saveStaticRelayToken(state, state.chamberToken);
        }
        state.registeredAgentName = card.name;
        startPolling(state, hooks);
        return {
          registered: true,
          agent: card,
          chamber: state.chamberBaseUrl,
          status: connectionStatus(state),
          response: body,
        };
      },
    },
    {
      name: "a2a_list_remote_agents",
      description: "List A2A agent cards currently registered in the connected relay.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const response = await chamberFetch(state, "/api/a2a/agents", { method: "GET" });
        return response.json();
      },
    },
    {
      name: "a2a_send_agent_message",
      description: "Send a message or reply from this Copilot CLI session to another registered A2A agent.",
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
          reply_to_message_id: {
            type: "string",
            description: "Optional inbound A2A messageId to reply to. Infers recipient and context_id from that inbound message unless overridden.",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        return sendA2AMessage(state, args);
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

function connectionStatus(state) {
  const connection = {
    connected: Boolean(state.registeredAgentName),
    relayBaseUrl: state.chamberBaseUrl || null,
    agentName: state.registeredAgentName ?? state.agentName ?? null,
    polling: Boolean(state.pollTimer),
  };
  return {
    ...connection,
    connections: [connection],
  };
}

async function sendA2AMessage(state, args) {
  const source = findReplySource(state.inbox, args.reply_to_message_id);
  const recipient = args.recipient ?? source?.sender?.id;
  if (!recipient) {
    throw new Error("A2A recipient is required unless reply_to_message_id matches an inbound message.");
  }
  const contextId = args.context_id ?? source?.contextId;
  const request = {
    recipient,
    message: {
      messageId: `msg-${randomUUID()}`,
      contextId,
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
  const body = await response.json();
  return {
    ...body,
    threading: {
      mode: source ? "reply_to_message_id" : contextId ? "context_id" : "direct",
      ...(args.reply_to_message_id ? { replyToMessageId: args.reply_to_message_id } : {}),
      ...(contextId ? { contextId } : {}),
      inferredRecipient: Boolean(!args.recipient && source?.sender?.id),
      inferredContext: Boolean(!args.context_id && source?.contextId),
    },
  };
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
  const update = { staticTokenFromArgument: false };
  if (typeof args.base_url === "string" && args.base_url.trim()) {
    state.chamberBaseUrl = args.base_url.trim().replace(/\/$/, "");
  }
  if (typeof args.token === "string" && args.token.trim()) {
    state.chamberToken = args.token.trim();
    update.staticTokenFromArgument = true;
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
  if (typeof args.login_hint === "string" && args.login_hint.trim()) {
    state.entraLoginHint = args.login_hint.trim();
  }
  if (typeof args.domain_hint === "string" && args.domain_hint.trim()) {
    state.entraDomainHint = args.domain_hint.trim();
  }
  if (!state.agentName || !String(state.agentName).trim()) {
    state.agentName = typeof state.defaultAgentName === "function" ? state.defaultAgentName() : defaultAgentName();
  }
  return update;
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
    throw new Error("A2A relay base URL is not configured. Run a2a_connection with action connect and base_url first.");
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
  await prepareRelayAuth(state, { staticTokenFromArgument: false });
  if (selectAuthMode(state) === "static") {
    if (!state.chamberToken) {
      throw new Error("A2A relay token is not configured. Run a2a_connection with token first.");
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
  await loadCachedEntraRefreshToken(state);
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
          state.refreshToken = null;
          await clearCachedEntraRefreshToken(state).catch((clearError) => {
            state.session?.log(`A2A token cache clear failed: ${clearError instanceof Error ? clearError.message : String(clearError)}`, {
              level: "warning",
              ephemeral: true,
            });
          });
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
  const waitForCode = state.waitForAuthCode ?? waitForAuthCode;
  const callback = await waitForCode(loginState);
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
  const loginHint = state.entraLoginHint || process.env.CHAMBER_A2A_LOGIN_HINT || process.env.SWITCHBOARD_LOGIN_HINT;
  const domainHint = state.entraDomainHint || process.env.CHAMBER_A2A_DOMAIN_HINT || process.env.SWITCHBOARD_DOMAIN_HINT;
  // Prefer domain_hint when set so contributors who share this repo aren't
  // pinned to a single user account. Falls back to login_hint when only a
  // specific UPN is known, and to a forced account picker otherwise.
  if (domainHint) {
    authorizeUrl.searchParams.set("domain_hint", domainHint);
  }
  if (loginHint) {
    authorizeUrl.searchParams.set("login_hint", loginHint);
  }
  if (!loginHint && !domainHint) {
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  state.session?.log(`Opening browser for Switchboard login: ${authorizeUrl.toString()}`, { ephemeral: false });
  await (state.openBrowser ?? openBrowser)(authorizeUrl.toString());
  const code = await callback.code;
  const token = await exchangeToken(state, tenantId, {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: `openid profile offline_access ${scope}`,
  });
  await applyTokenResponse(state, token);
  return state.accessToken;
}

async function refreshAccessToken(state) {
  const clientId = getClientId(state);
  const tenantId = state.entraTenantId || process.env.CHAMBER_A2A_TENANT_ID || "common";
  const scope = state.entraScope || `api://${clientId}/user_impersonation`;
  const token = await exchangeToken(state, tenantId, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
    scope: `openid profile offline_access ${scope}`,
  });
  await applyTokenResponse(state, token);
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

async function exchangeToken(state, tenantId, form) {
  const fetchImpl = state.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
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

async function applyTokenResponse(state, token) {
  state.accessToken = token.access_token;
  state.refreshToken = token.refresh_token ?? state.refreshToken;
  state.accessTokenExpiresAt = Date.now() + Number(token.expires_in ?? 3600) * 1000;
  if (!state.accessToken) {
    throw new Error("Switchboard token response did not include an access token.");
  }
  if (state.refreshToken) {
    await saveCachedEntraRefreshToken(state, state.refreshToken);
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

async function prepareRelayAuth(state, update) {
  const mode = state.authMode && state.authMode !== "auto" ? state.authMode : "auto";
  if ((mode === "static" || mode === "auto") && !state.chamberToken) {
    state.chamberToken = await getStoredStaticRelayToken(state) ?? "";
  }
  if (update.staticTokenFromArgument && !state.chamberToken) {
    throw new Error("A2A relay token is not configured. Run a2a_connection with token first.");
  }
}

async function getStoredStaticRelayToken(state) {
  const credentialStore = await getCredentialStore(state);
  if (!credentialStore || !state.chamberBaseUrl) return null;
  const account = getRelayCredentialAccount(state.chamberBaseUrl);
  const credential = (await credentialStore.findCredentials(A2A_RELAY_CREDENTIAL_SERVICE))
    .find((entry) => entry.account === account);
  return credential?.password?.trim() || null;
}

async function saveStaticRelayToken(state, token) {
  if (!token?.trim()) return;
  const credentialStore = await requireCredentialStore(state);
  await credentialStore.setPassword(
    A2A_RELAY_CREDENTIAL_SERVICE,
    getRelayCredentialAccount(state.chamberBaseUrl),
    token.trim(),
  );
}

async function loadCachedEntraRefreshToken(state) {
  if (state.entraTokenCacheLoaded) return;
  state.entraTokenCacheLoaded = true;
  if (state.refreshToken) return;
  const credentialStore = await getCredentialStore(state);
  if (!credentialStore || !state.chamberBaseUrl) return;
  const account = getEntraRelayCredentialAccount(state);
  const credential = (await credentialStore.findCredentials(A2A_RELAY_ENTRA_CREDENTIAL_SERVICE))
    .find((entry) => entry.account === account);
  if (!credential?.password) return;
  const entry = parseEntraRelayTokenCacheEntry(credential.password);
  if (!entry) {
    await credentialStore.deletePassword(A2A_RELAY_ENTRA_CREDENTIAL_SERVICE, account);
    return;
  }
  state.refreshToken = entry.refreshToken;
}

async function saveCachedEntraRefreshToken(state, refreshToken) {
  const credentialStore = await requireCredentialStore(state);
  await credentialStore.setPassword(
    A2A_RELAY_ENTRA_CREDENTIAL_SERVICE,
    getEntraRelayCredentialAccount(state),
    JSON.stringify({ refreshToken }),
  );
}

async function clearCachedEntraRefreshToken(state) {
  const credentialStore = await getCredentialStore(state);
  if (!credentialStore || !state.chamberBaseUrl) return;
  await credentialStore.deletePassword(
    A2A_RELAY_ENTRA_CREDENTIAL_SERVICE,
    getEntraRelayCredentialAccount(state),
  );
}

function parseEntraRelayTokenCacheEntry(value) {
  if (value.trim().length > 0 && !value.trim().startsWith("{")) {
    return { refreshToken: value.trim() };
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return typeof parsed.refreshToken === "string" && parsed.refreshToken.trim()
    ? { refreshToken: parsed.refreshToken.trim() }
    : null;
}

export function getRelayCredentialAccount(relayBaseUrl) {
  return URL.canParse(relayBaseUrl) ? new URL(relayBaseUrl).origin : relayBaseUrl.trim();
}

export function getEntraRelayCredentialAccount(state) {
  const clientId = getClientId(state);
  const tenantId = state.entraTenantId || process.env.CHAMBER_A2A_TENANT_ID || "common";
  const scope = state.entraScope || `api://${clientId}/user_impersonation`;
  return [
    getRelayCredentialAccount(state.chamberBaseUrl),
    clientId.trim(),
    tenantId.trim() || "common",
    scope.trim() || `api://${clientId}/user_impersonation`,
  ].join("|");
}

async function requireCredentialStore(state) {
  const credentialStore = await getCredentialStore(state);
  if (!credentialStore) {
    throw new Error("A2A credential store is unavailable. Install or unlock the OS keychain/keyring, or pass a token explicitly.");
  }
  return credentialStore;
}

async function getCredentialStore(state) {
  if ("credentialStore" in state) return state.credentialStore ?? null;
  if (state.credentialStoreRequest) return state.credentialStoreRequest;
  state.credentialStoreRequest = import("keytar")
    .then((module) => module.default ?? module)
    .catch((error) => {
      state.session?.log(`A2A credential store unavailable: ${error instanceof Error ? error.message : String(error)}`, {
        level: "warning",
        ephemeral: true,
      });
      return null;
    });
  return state.credentialStoreRequest;
}

export function defaultAgentName(options = {}) {
  const env = options.env ?? process.env;
  const userInfo = options.userInfo ?? (() => os.userInfo());
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const user = slug(firstNonEmpty(env.CHAMBER_A2A_USER, env.GITHUB_USER, env.USER, env.USERNAME, userInfo().username) ?? "unknown");
  const repo = slug(firstNonEmpty(env.CHAMBER_A2A_REPO, env.GITHUB_REPOSITORY?.split("/").at(-1), path.basename(cwd)) ?? "repo");
  return `${user || "unknown"}-copilot-${repo || "repo"}-${normalizeHostOs(platform)}`;
}

function normalizeHostOs(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  if (platform === "linux") return "linux";
  return slug(platform || "unknown") || "unknown";
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
