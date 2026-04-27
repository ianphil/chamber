import { describe, expect, it, vi } from 'vitest';
import {
  addMindHandler,
  listModelsHandler,
  newConversationHandler,
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
});

function makeContext(overrides: Partial<ChamberCtx>): ChamberCtx {
  return {
    token: 'test-token',
    allowedOrigins: new Set(['http://127.0.0.1']),
    listMinds: () => [],
    ...overrides,
  };
}
