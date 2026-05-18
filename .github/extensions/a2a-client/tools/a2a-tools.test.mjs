import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createA2ATools,
  defaultAgentName,
  disconnectA2AClient,
  getEntraRelayCredentialAccount,
  getRelayCredentialAccount,
  pollA2AMessages,
} from "./a2a-tools.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("A2A client tools", () => {
  it("unregisters the previous relay card before reconnecting", async () => {
    vi.useFakeTimers();
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method, body: options?.body });
      return jsonResponse({ ok: true });
    }));
    const state = createState();
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-one" });
    await connect.handler({ base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-two" });

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/a2a/agents",
      "DELETE /api/a2a/agents/cli-one",
      "POST /api/a2a/agents",
    ]);
    const firstCard = JSON.parse(requests[0].body).card;
    expect(firstCard.description).toContain("If this agent is available");
    expect(firstCard.skills[0]).toEqual(expect.objectContaining({
      name: "Chamber repo coordination",
      tags: expect.arrayContaining(["chamber", "repo"]),
    }));
    expect(state.registeredAgentName).toBe("cli-two");
    await disconnectA2AClient(state);
  });

  it("stops polling and unregisters the current relay card on disconnect", async () => {
    vi.useFakeTimers();
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method });
      return jsonResponse({ ok: true });
    }));
    const state = createState();
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-one" });
    await disconnectA2AClient(state);

    expect(state.pollTimer).toBeNull();
    expect(state.registeredAgentName).toBeNull();
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toContain(
      "DELETE /api/a2a/agents/cli-one",
    );
  });

  it("acks delivered poll messages before surfacing a later delivery failure", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method, body: options?.body });
      if (String(url).endsWith("/api/a2a/messages:poll")) {
        return jsonResponse({
          messages: [
            {
              id: "relay-msg-1",
              request: { recipient: "cli-one", message: { messageId: "msg-1", role: "ROLE_USER", parts: [{ text: "hi" }] } },
            },
            {
              id: "relay-msg-2",
              request: { recipient: "cli-one", message: { messageId: "msg-2", role: "ROLE_USER", parts: [{ text: "boom" }] } },
            },
          ],
        });
      }
      return jsonResponse({ acked: 1 });
    }));
    const state = {
      ...createState(),
      chamberBaseUrl: "http://127.0.0.1:4100",
      chamberToken: "secret",
      agentName: "cli-one",
    };
    const hooks = {
      onMessage: vi.fn()
        .mockReturnValueOnce(undefined)
        .mockImplementationOnce(() => {
          throw new Error("delivery failed");
        }),
    };

    await expect(pollA2AMessages(state, hooks)).rejects.toThrow("delivery failed");

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/a2a/messages:poll",
      "POST /api/a2a/messages:ack",
    ]);
    expect(JSON.parse(requests[1].body)).toEqual({ messageIds: ["relay-msg-1"] });
  });

  it("surfaces only the connection, list, and send tools", () => {
    const tools = createA2ATools(createState(), { onMessage: vi.fn() });

    expect(tools.map((tool) => tool.name)).toEqual([
      "a2a_connection",
      "a2a_list_remote_agents",
      "a2a_send_agent_message",
    ]);
  });

  it("disconnects and reports status through a2a_connection actions", async () => {
    vi.useFakeTimers();
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method, body: options?.body });
      return jsonResponse({ ok: true });
    }));
    const state = createState();
    const connection = getTool("a2a_connection", state);

    await connection.handler({ action: "connect", base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-one" });
    await expect(connection.handler({ action: "status" })).resolves.toEqual(expect.objectContaining({
      connected: true,
      relayBaseUrl: "http://127.0.0.1:4100",
      agentName: "cli-one",
      polling: true,
      connections: [
        expect.objectContaining({
          connected: true,
          relayBaseUrl: "http://127.0.0.1:4100",
          agentName: "cli-one",
          polling: true,
        }),
      ],
    }));
    await expect(connection.handler({ action: "disconnect" })).resolves.toEqual(expect.objectContaining({
      connected: false,
      relayBaseUrl: "http://127.0.0.1:4100",
      agentName: "cli-one",
      polling: false,
    }));

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/a2a/agents",
      "DELETE /api/a2a/agents/cli-one",
    ]);
  });

  it("sends replies through a2a_send_agent_message using an inbound message id", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method, body: options?.body });
      return jsonResponse({ ok: true });
    }));
    const state = {
      ...createState(),
      chamberBaseUrl: "http://127.0.0.1:4100",
      chamberToken: "secret",
      agentName: "cli-one",
      inbox: [{
        id: "inbound-1",
        contextId: "ctx-1",
        sender: { id: "alice-agent", name: "Alice" },
      }],
    };
    const send = getTool("a2a_send_agent_message", state);

    const result = await send.handler({ reply_to_message_id: "inbound-1", message: "hello back" });

    const request = JSON.parse(requests.find((entry) => String(entry.url).endsWith("/api/a2a/message:send")).body);
    expect(request.recipient).toBe("alice-agent");
    expect(request.message.contextId).toBe("ctx-1");
    expect(request.message.parts[0].text).toBe("hello back");
    expect(result.threading).toEqual({
      mode: "reply_to_message_id",
      replyToMessageId: "inbound-1",
      contextId: "ctx-1",
      inferredRecipient: true,
      inferredContext: true,
    });
  });

  it("reports explicit context threading when the inbound reply id is not in memory", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ queued: true })));
    const state = {
      ...createState(),
      chamberBaseUrl: "http://127.0.0.1:4100",
      chamberToken: "secret",
      agentName: "cli-one",
    };
    const send = getTool("a2a_send_agent_message", state);

    const result = await send.handler({
      recipient: "alice-agent",
      reply_to_message_id: "stale-inbound",
      context_id: "ctx-1",
      message: "hello back",
    });

    expect(result.threading).toEqual({
      mode: "context_id",
      replyToMessageId: "stale-inbound",
      contextId: "ctx-1",
      inferredRecipient: false,
      inferredContext: false,
    });
  });

  it("requires a recipient when send does not reference an inbound message", async () => {
    const state = {
      ...createState(),
      chamberBaseUrl: "http://127.0.0.1:4100",
      chamberToken: "secret",
      agentName: "cli-one",
    };
    const send = getTool("a2a_send_agent_message", state);

    await expect(send.handler({ message: "hello" })).rejects.toThrow(
      "A2A recipient is required unless reply_to_message_id matches an inbound message.",
    );
  });

  it("reuses Chamber's stored static relay token when connect omits token", async () => {
    vi.useFakeTimers();
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), method: options?.method, authorization: options?.headers?.authorization });
      return jsonResponse({ ok: true });
    }));
    const state = createState({
      credentialStore: createCredentialStore([
        { account: "http://127.0.0.1:4100", password: "stored-token" },
      ]),
    });
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100/path", auth_mode: "static", agent_name: "cli-one" });

    expect(requests[0]).toEqual(expect.objectContaining({
      method: "POST",
      authorization: "Bearer stored-token",
    }));
    expect(state.credentialStore.setPassword).not.toHaveBeenCalled();
    await disconnectA2AClient(state);
  });

  it("saves explicitly supplied static relay tokens using Chamber's credential contract after connect succeeds", async () => {
    vi.useFakeTimers();
    const state = createState({
      credentialStore: createCredentialStore([
        { account: "http://127.0.0.1:4100", password: "stored-token" },
      ]),
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      expect(options?.headers?.authorization).toBe("Bearer explicit-token");
      return jsonResponse({ ok: true });
    }));
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100/path", token: "explicit-token", agent_name: "cli-one" });

    expect(state.credentialStore.setPassword).toHaveBeenCalledWith(
      "chamber-a2a-relay",
      "http://127.0.0.1:4100",
      "explicit-token",
    );
    await disconnectA2AClient(state);
  });

  it("does not persist relay tokens that came only from the environment", async () => {
    vi.useFakeTimers();
    const state = createState({
      chamberToken: "env-token",
      credentialStore: createCredentialStore(),
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      expect(options?.headers?.authorization).toBe("Bearer env-token");
      return jsonResponse({ ok: true });
    }));
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100", auth_mode: "static", agent_name: "cli-one" });

    expect(state.credentialStore.setPassword).not.toHaveBeenCalled();
    await disconnectA2AClient(state);
  });

  it("loads and rotates Chamber's stored Entra relay refresh token", async () => {
    vi.useFakeTimers();
    const credentialStore = createCredentialStore([
      {
        account: "https://switchboard.example.com|client-id|common|api://client-id/user_impersonation",
        password: JSON.stringify({ refreshToken: "cached-refresh-token" }),
      },
    ]);
    const requests = [];
    const state = createState({
      authMode: "interactive",
      entraClientId: "client-id",
      credentialStore,
    });
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      requests.push({ url: String(url), body: options?.body, authorization: options?.headers?.authorization });
      if (String(url).includes("login.microsoftonline.com")) {
        const body = new URLSearchParams(String(options?.body));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("cached-refresh-token");
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "next-refresh-token",
          expires_in: 3600,
        });
      }
      expect(options?.headers?.authorization).toBe("Bearer access-token");
      return jsonResponse({ ok: true });
    }));
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "https://switchboard.example.com", auth_mode: "interactive", agent_name: "cli-one" });

    expect(credentialStore.setPassword).toHaveBeenCalledWith(
      "chamber-a2a-relay-entra",
      "https://switchboard.example.com|client-id|common|api://client-id/user_impersonation",
      JSON.stringify({ refreshToken: "next-refresh-token" }),
    );
    expect(requests.some((request) => String(request.url).includes("login.microsoftonline.com"))).toBe(true);
    await disconnectA2AClient(state);
  });

  it("clears invalid Entra token cache entries before interactive auth", async () => {
    vi.useFakeTimers();
    const credentialStore = createCredentialStore([
      {
        account: "https://switchboard.example.com|client-id|common|api://client-id/user_impersonation",
        password: "{not-json",
      },
    ]);
    const state = createState({
      authMode: "interactive",
      entraClientId: "client-id",
      credentialStore,
      waitForAuthCode: vi.fn(async () => ({ port: 48123, code: "auth-code" })),
      openBrowser: vi.fn(async () => undefined),
    });
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("login.microsoftonline.com")) {
        const body = new URLSearchParams(String(options?.body));
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("auth-code");
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "interactive-refresh-token",
          expires_in: 3600,
        });
      }
      return jsonResponse({ ok: true });
    }));
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "https://switchboard.example.com", auth_mode: "interactive", agent_name: "cli-one" });

    expect(credentialStore.deletePassword).toHaveBeenCalledWith(
      "chamber-a2a-relay-entra",
      "https://switchboard.example.com|client-id|common|api://client-id/user_impersonation",
    );
    expect(credentialStore.setPassword).toHaveBeenCalledWith(
      "chamber-a2a-relay-entra",
      "https://switchboard.example.com|client-id|common|api://client-id/user_impersonation",
      JSON.stringify({ refreshToken: "interactive-refresh-token" }),
    );
    await disconnectA2AClient(state);
  });

  it("derives Chamber relay credential accounts exactly like the desktop app", () => {
    expect(getRelayCredentialAccount("http://127.0.0.1:4100/path/")).toBe("http://127.0.0.1:4100");
    expect(getRelayCredentialAccount("https://switchboard.example.com/a2a")).toBe("https://switchboard.example.com");
    expect(getRelayCredentialAccount("not a url")).toBe("not a url");
    expect(getEntraRelayCredentialAccount({
      chamberBaseUrl: "https://switchboard.example.com/a2a",
      entraClientId: "client-id",
      entraTenantId: "",
      entraScope: "",
    })).toBe("https://switchboard.example.com|client-id|common|api://client-id/user_impersonation");
  });

  it("derives default relay agent names from user, repo, and host OS", () => {
    expect(defaultAgentName({
      cwd: "C:\\src\\chamber",
      env: { USERNAME: "Ian Phil" },
      platform: "win32",
      userInfo: () => ({ username: "ignored" }),
    })).toBe("ian-phil-copilot-chamber-windows");
    expect(defaultAgentName({
      cwd: "/Users/ian/src/chamber",
      env: { USER: "ianphil" },
      platform: "darwin",
      userInfo: () => ({ username: "ignored" }),
    })).toBe("ianphil-copilot-chamber-mac");
    expect(defaultAgentName({
      cwd: "/home/ian/src/chamber",
      env: { GITHUB_REPOSITORY: "ianphil/chamber", USER: "ianphil" },
      platform: "linux",
      userInfo: () => ({ username: "ignored" }),
    })).toBe("ianphil-copilot-chamber-linux");
    expect(defaultAgentName({
      cwd: "/repo",
      env: { USER: "" },
      platform: "freebsd",
      userInfo: () => ({ username: "" }),
    })).toBe("unknown-copilot-repo-freebsd");
  });

  it("uses the generated agent name for relay registration unless agent_name is provided", async () => {
    vi.useFakeTimers();
    const registeredCards = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (options?.method === "POST" && String(url).endsWith("/api/a2a/agents")) {
        registeredCards.push(JSON.parse(options.body).card);
      }
      return jsonResponse({ ok: true });
    }));
    const state = createState({
      agentName: "",
      chamberToken: "secret",
      defaultAgentName: () => "ianphil-copilot-chamber-windows",
    });
    const connect = getTool("a2a_connection", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100", auth_mode: "static" });
    await connect.handler({ base_url: "http://127.0.0.1:4100", auth_mode: "static", agent_name: "explicit-agent" });

    expect(registeredCards.map((card) => card.name)).toEqual([
      "ianphil-copilot-chamber-windows",
      "explicit-agent",
    ]);
    await disconnectA2AClient(state);
  });
});

function getTool(name, state) {
  const tools = createA2ATools(state, { onMessage: vi.fn() });
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function createState(overrides = {}) {
  return {
    chamberBaseUrl: "",
    chamberToken: "",
    authMode: "auto",
    entraClientId: "",
    entraTenantId: "common",
    entraScope: "",
    accessToken: null,
    refreshToken: null,
    accessTokenExpiresAt: 0,
    tokenRequest: null,
    agentName: "Copilot CLI",
    registeredAgentName: null,
    inbox: [],
    session: { log: vi.fn() },
    pollTimer: null,
    ...overrides,
  };
}

function createCredentialStore(entries = []) {
  return {
    findCredentials: vi.fn(async (service) => {
      void service;
      return entries;
    }),
    setPassword: vi.fn(async (service, account, password) => {
      const existing = entries.find((entry) => entry.account === account);
      if (existing) {
        existing.password = password;
      } else {
        entries.push({ account, password });
      }
      void service;
    }),
    deletePassword: vi.fn(async (_service, account) => {
      const index = entries.findIndex((entry) => entry.account === account);
      if (index >= 0) entries.splice(index, 1);
      return true;
    }),
  };
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
