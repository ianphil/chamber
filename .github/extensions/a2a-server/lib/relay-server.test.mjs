import { describe, it, expect, afterEach } from "vitest";

import { createA2ARelayServer } from "./relay-server.mjs";

const token = "relay-secret";
let relay;

afterEach(async () => {
  await relay?.stop();
  relay = undefined;
});

describe("A2A relay server", () => {
  it("requires bearer auth for registry access", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();

    const response = await fetch(`http://127.0.0.1:${port}/api/a2a/agents`);

    expect(response.status).toBe(401);
  });

  it("registers and lists agent cards", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();
    const card = makeCard("Copilot CLI");

    const register = await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card, inboundAuth: { scheme: "bearer", token: "client-secret" } }),
    });
    const list = await relayFetch(port, "/api/a2a/agents");

    expect(register.status).toBe(200);
    expect(await list.json()).toEqual({ agents: [card] });
  });

  it("enqueues messages for the target card", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();
    const card = makeCard("Copilot CLI", "http://127.0.0.1:4100/a2a");
    await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card, inboundAuth: { scheme: "bearer", token: "client-secret" } }),
    });

    const response = await relayFetch(port, "/api/a2a/message:send", {
      method: "POST",
      body: JSON.stringify({
        recipient: "Copilot CLI",
        message: { messageId: "msg-1", role: "user", parts: [{ text: "hello" }] },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      queued: true,
      queueMessageId: expect.stringMatching(/^relay-msg-/),
      message: expect.objectContaining({ messageId: "msg-1" }),
    }));
    expect(relay.listMessages()).toEqual([expect.objectContaining({
      recipient: "Copilot CLI",
      request: expect.objectContaining({ recipient: "Copilot CLI" }),
    })]);
  });

  it("polls queued messages by registered card name and acks them", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();
    await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card: makeCard("Copilot CLI") }),
    });
    const send = await relayFetch(port, "/api/a2a/message:send", {
      method: "POST",
      body: JSON.stringify({
        recipient: "Copilot CLI",
        message: { messageId: "msg-1", role: "user", parts: [{ text: "hello" }] },
      }),
    });
    const { queueMessageId } = await send.json();

    const poll = await relayFetch(port, "/api/a2a/messages:poll", {
      method: "POST",
      body: JSON.stringify({ recipients: ["Copilot CLI"] }),
    });
    const pollBody = await poll.json();
    const ack = await relayFetch(port, "/api/a2a/messages:ack", {
      method: "POST",
      body: JSON.stringify({ messageIds: [queueMessageId] }),
    });
    const secondPoll = await relayFetch(port, "/api/a2a/messages:poll", {
      method: "POST",
      body: JSON.stringify({ recipients: ["Copilot CLI"] }),
    });

    expect(poll.status).toBe(200);
    expect(pollBody.messages).toEqual([expect.objectContaining({
      id: queueMessageId,
      recipient: "Copilot CLI",
      request: expect.objectContaining({ recipient: "Copilot CLI" }),
      attempts: 1,
    })]);
    await expect(ack.json()).resolves.toEqual({ acknowledged: 1 });
    await expect(secondPoll.json()).resolves.toEqual({ messages: [] });
  });

  it("polls queued messages by mind id", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();
    await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card: { ...makeCard("Chamber Mind"), mindId: "mind-a" } }),
    });
    const send = await relayFetch(port, "/api/a2a/message:send", {
      method: "POST",
      body: JSON.stringify({
        recipient: "mind-a",
        message: { messageId: "msg-1", role: "user", parts: [{ text: "hello" }] },
      }),
    });
    const { queueMessageId } = await send.json();

    const poll = await relayFetch(port, "/api/a2a/messages:poll", {
      method: "POST",
      body: JSON.stringify({ recipients: ["mind-a"] }),
    });

    await expect(poll.json()).resolves.toEqual({ messages: [expect.objectContaining({ id: queueMessageId })] });
  });

  it("redelivers polled messages after their lease expires when they are not acked", async () => {
    relay = createA2ARelayServer({ token, leaseMs: 1 });
    const { port } = await relay.start();
    await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card: makeCard("Copilot CLI") }),
    });
    await relayFetch(port, "/api/a2a/message:send", {
      method: "POST",
      body: JSON.stringify({
        recipient: "Copilot CLI",
        message: { messageId: "msg-1", role: "user", parts: [{ text: "hello" }] },
      }),
    });

    const first = await relayFetch(port, "/api/a2a/messages:poll", {
      method: "POST",
      body: JSON.stringify({ recipients: ["Copilot CLI"] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await relayFetch(port, "/api/a2a/messages:poll", {
      method: "POST",
      body: JSON.stringify({ recipients: ["Copilot CLI"] }),
    });

    expect((await first.json()).messages[0].attempts).toBe(1);
    expect((await second.json()).messages[0].attempts).toBe(2);
  });

  it("does not require target callback interfaces for queued delivery", async () => {
    relay = createA2ARelayServer({ token });
    const { port } = await relay.start();
    await relayFetch(port, "/api/a2a/agents", {
      method: "POST",
      body: JSON.stringify({ card: makeCard("Remote", "https://example.com/a2a") }),
    });

    const response = await relayFetch(port, "/api/a2a/message:send", {
      method: "POST",
      body: JSON.stringify({
        recipient: "Remote",
        message: { messageId: "msg-1", role: "user", parts: [{ text: "hello" }] },
      }),
    });

    expect(response.status).toBe(200);
  });
});

function relayFetch(port, path, init = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function makeCard(name, url = "http://127.0.0.1:4100/a2a") {
  return {
    name,
    description: `${name} agent`,
    version: "1.0.0",
    supportedInterfaces: [{ url, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
    capabilities: {},
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
  };
}
