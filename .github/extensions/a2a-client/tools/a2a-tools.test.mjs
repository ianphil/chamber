import { afterEach, describe, expect, it, vi } from "vitest";

import { createA2ATools, disconnectA2AClient } from "./a2a-tools.mjs";

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
