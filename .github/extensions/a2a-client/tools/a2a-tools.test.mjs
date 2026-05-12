import { afterEach, describe, expect, it, vi } from "vitest";

import { createA2ATools, disconnectA2AClient, pollA2AMessages } from "./a2a-tools.mjs";

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
    const connect = getTool("chamber_a2a_connect", state);

    await connect.handler({ base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-one" });
    await connect.handler({ base_url: "http://127.0.0.1:4100", token: "secret", agent_name: "cli-two" });

    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /api/a2a/agents",
      "DELETE /api/a2a/agents/cli-one",
      "POST /api/a2a/agents",
    ]);
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
    const connect = getTool("chamber_a2a_connect", state);

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
              request: { recipient: "cli-one", message: { messageId: "msg-1", role: "user", parts: [{ text: "hi" }] } },
            },
            {
              id: "relay-msg-2",
              request: { recipient: "cli-one", message: { messageId: "msg-2", role: "user", parts: [{ text: "boom" }] } },
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
});

function getTool(name, state) {
  const tools = createA2ATools(state, { onMessage: vi.fn() });
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function createState() {
  return {
    chamberBaseUrl: "",
    chamberToken: "",
    agentName: "Copilot CLI",
    registeredAgentName: null,
    inbox: [],
    session: { log: vi.fn() },
    pollTimer: null,
  };
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    json: async () => body,
  };
}
