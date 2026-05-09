import { describe, expect, it, vi } from 'vitest';
import {
  addMindHandler,
  cancelChatHandler,
  getA2AAgentCardHandler,
  listA2AAgentsHandler,
  listModelsHandler,
  newConversationHandler,
  registerA2AAgentCardHandler,
  sendA2AMessageHandler,
  sendChatHandler,
} from './handlers';
import type { ChamberCtx } from './types';

describe('server handlers', () => {
  it('loads an existing local mind through the server context', async () => {
    const addMind = vi.fn(async (mindPath: string) => ({ mindId: 'dude-1234', mindPath }));

    const response = await addMindHandler({
      method: 'POST',
      path: '/api/mind/add',
      headers: new Headers(),
      body: { mindPath: 'C:\\agents\\dude' },
    }, makeContext({ addMind }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mind: { mindId: 'dude-1234', mindPath: 'C:\\agents\\dude' } });
    expect(addMind).toHaveBeenCalledWith('C:\\agents\\dude');
  });

  it('surfaces local mind load failures with the original message', async () => {
    const addMind = vi.fn(async () => {
      throw new Error('Invalid mind directory');
    });

    const response = await addMindHandler({
      method: 'POST',
      path: '/api/mind/add',
      headers: new Headers(),
      body: { mindPath: 'C:\\agents\\bad' },
    }, makeContext({ addMind }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid mind directory' });
  });

  it('sends chat through the server context', async () => {
    const sendChat = vi.fn(async () => undefined);

    const response = await sendChatHandler({
      method: 'POST',
      path: '/api/chat/send',
      headers: new Headers(),
      body: {
        mindId: 'dude-1234',
        message: 'Hello',
        messageId: 'assistant-1',
        model: 'claude-sonnet',
      },
    }, makeContext({ sendChat }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(sendChat).toHaveBeenCalledWith({
      mindId: 'dude-1234',
      message: 'Hello',
      messageId: 'assistant-1',
      model: 'claude-sonnet',
      attachments: undefined,
    });
  });

  it('passes valid chat attachments through the server context', async () => {
    const sendChat = vi.fn(async () => undefined);
    const attachment = { name: 'image.png', mimeType: 'image/png', data: 'abc123' };

    const response = await sendChatHandler({
      method: 'POST',
      path: '/api/chat/send',
      headers: new Headers(),
      body: {
        mindId: 'dude-1234',
        message: 'Hello',
        messageId: 'assistant-1',
        attachments: [attachment],
      },
    }, makeContext({ sendChat }));

    expect(response.status).toBe(200);
    expect(sendChat).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [attachment],
    }));
  });

  it('rejects invalid chat attachments', async () => {
    const sendChat = vi.fn(async () => undefined);

    const response = await sendChatHandler({
      method: 'POST',
      path: '/api/chat/send',
      headers: new Headers(),
      body: {
        mindId: 'dude-1234',
        message: 'Hello',
        messageId: 'assistant-1',
        attachments: [{ name: 'image.png', data: 'abc123' }],
      },
    }, makeContext({ sendChat }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'attachments must be valid chat attachments' });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('starts a new conversation through the server context', async () => {
    const newConversation = vi.fn(async () => undefined);

    const response = await newConversationHandler({
      method: 'POST',
      path: '/api/chat/new',
      headers: new Headers(),
      body: { mindId: 'dude-1234' },
    }, makeContext({ newConversation }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(newConversation).toHaveBeenCalledWith('dude-1234');
  });

  it('cancels chat for the requested mind', async () => {
    const cancelChat = vi.fn(async () => undefined);

    const response = await cancelChatHandler({
      method: 'POST',
      path: '/api/chat/cancel',
      headers: new Headers(),
      body: { mindId: 'dude-1234', messageId: 'assistant-1' },
    }, makeContext({ cancelChat }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(cancelChat).toHaveBeenCalledWith('dude-1234', 'assistant-1');
  });

  it('lists models through the server context', async () => {
    const listModels = vi.fn(async () => [{ id: 'claude-sonnet', name: 'Claude Sonnet' }]);

    const response = await listModelsHandler({
      method: 'GET',
      path: '/api/chat/models',
      headers: new Headers(),
      query: new URLSearchParams('mindId=dude-1234'),
    }, makeContext({ listModels }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] });
    expect(listModels).toHaveBeenCalledWith('dude-1234');
  });

  it('lists A2A agent cards through the server context', async () => {
    const card = makeA2ACard('Dude', 'dude-1234');
    const listA2AAgents = vi.fn(() => [card]);

    const response = await listA2AAgentsHandler({
      method: 'GET',
      path: '/api/a2a/agents',
      headers: new Headers(),
    }, makeContext({ listA2AAgents }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ agents: [card] });
  });

  it('gets an A2A agent card by route recipient', async () => {
    const card = makeA2ACard('Dude', 'dude-1234');
    const getA2AAgentCard = vi.fn(() => card);

    const response = await getA2AAgentCardHandler({
      method: 'GET',
      path: '/api/a2a/agents/dude-1234/card',
      headers: new Headers(),
    }, makeContext({ getA2AAgentCard }));

    expect(response.status).toBe(200);
    expect(response.body).toBe(card);
    expect(getA2AAgentCard).toHaveBeenCalledWith('dude-1234');
  });

  it('registers a remote A2A agent card through the server context', async () => {
    const card = makeA2ACard('Copilot CLI');
    const registerA2AAgentCard = vi.fn();

    const response = await registerA2AAgentCardHandler({
      method: 'POST',
      path: '/api/a2a/agents',
      headers: new Headers(),
      body: { card },
    }, makeContext({ registerA2AAgentCard }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, agent: card });
    expect(registerA2AAgentCard).toHaveBeenCalledWith(card);
  });

  it('sends A2A messages only to local recipients at the HTTP boundary', async () => {
    const sendA2AMessage = vi.fn(async () => ({
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Hello' }] },
    }));
    const request = {
      recipient: 'dude-1234',
      message: { messageId: 'msg-1', role: 'user' as const, parts: [{ text: 'Hello' }] },
    };

    const response = await sendA2AMessageHandler({
      method: 'POST',
      path: '/api/a2a/message:send',
      headers: new Headers(),
      body: request,
    }, makeContext({ sendA2AMessage }));

    expect(response.status).toBe(200);
    expect(sendA2AMessage).toHaveBeenCalledWith(request, { allowRemoteRecipients: false });
  });
});

function notConfigured(name: string): () => never {
  return () => {
    throw new Error(`Test stub: ${name} not configured`);
  };
}

function makeContext(overrides: Partial<ChamberCtx>): ChamberCtx {
  return {
    token: 'test-token',
    allowedOrigins: new Set(['http://127.0.0.1']),
    listMinds: () => [],
    addMind: notConfigured('addMind'),
    getConfig: notConfigured('getConfig'),
    listLensViews: notConfigured('listLensViews'),
    getGenesisStatus: notConfigured('getGenesisStatus'),
    getAuthStatus: notConfigured('getAuthStatus'),
    listAuthAccounts: notConfigured('listAuthAccounts'),
    startAuthLogin: notConfigured('startAuthLogin'),
    switchAuthAccount: notConfigured('switchAuthAccount'),
    logoutAuth: notConfigured('logoutAuth'),
    listChamberTools: notConfigured('listChamberTools'),
    saveAttachment: notConfigured('saveAttachment'),
    sendChat: notConfigured('sendChat'),
    newConversation: notConfigured('newConversation'),
    cancelChat: notConfigured('cancelChat'),
    listModels: notConfigured('listModels'),
    shutdown: () => {},
    handlePrivilegedRequest: notConfigured('handlePrivilegedRequest'),
    ...overrides,
  };
}

function makeA2ACard(name: string, mindId?: string) {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    supportedInterfaces: [{ url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' }],
    capabilities: {},
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    mindId,
  };
}
