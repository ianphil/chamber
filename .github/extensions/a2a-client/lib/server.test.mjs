import { describe, expect, it, afterEach, vi } from "vitest";

import { createA2AServer } from "./server.mjs";

let currentServer = null;

afterEach(async () => {
  await currentServer?.stop();
  currentServer = null;
});

describe("A2A extension loopback server", () => {
  it("requires bearer auth before queueing inbound messages", async () => {
    const onMessage = vi.fn();
    const server = createTestServer({ onMessage });
    currentServer = server;
    const port = await server.start();

    const unauthorized = await postMessage(port, "wrong-token");
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(onMessage).not.toHaveBeenCalled();

    const authorized = await postMessage(port, "test-token");
    expect(authorized.status).toBe(200);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("protects both A2A message send aliases", async () => {
    const onMessage = vi.fn();
    const server = createTestServer({ onMessage });
    currentServer = server;
    const port = await server.start();

    const response = await postMessage(port, undefined, "/a2a/message:send");

    expect(response.status).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("limits inbound request body size", async () => {
    const onMessage = vi.fn();
    const server = createTestServer({ onMessage });
    currentServer = server;
    const port = await server.start();

    const response = await fetch(`http://127.0.0.1:${port}/message:send`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/a2a+json",
      },
      body: JSON.stringify({
        recipient: "Copilot CLI",
        message: {
          messageId: "msg-big",
          role: "user",
          parts: [{ text: "x".repeat(1_000_001), mediaType: "text/plain" }],
        },
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request body too large" });
    expect(onMessage).not.toHaveBeenCalled();
  });
});

function createTestServer({ onMessage }) {
  return createA2AServer({
    getAgentName: () => "Copilot CLI",
    getInboundToken: () => "test-token",
    onMessage,
    log: vi.fn(),
  });
}

function postMessage(port, token, path = "/message:send") {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/a2a+json",
    },
    body: JSON.stringify({
      recipient: "Copilot CLI",
      message: {
        messageId: "msg-1",
        contextId: "ctx-1",
        role: "user",
        parts: [{ text: "Hello", mediaType: "text/plain" }],
      },
    }),
  });
}
