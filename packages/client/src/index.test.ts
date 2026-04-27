import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChamberClient } from './index';

describe('ChamberClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  it('loads a local mind path through the loopback server', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      mind: { mindId: 'dude-1234', mindPath: 'C:\\agents\\dude', identity: { name: 'Dude', systemMessage: '' }, status: 'ready' },
    }), { status: 200 }));
    const client = new ChamberClient({ baseUrl: 'http://127.0.0.1:3000', token: 'token', origin: 'http://127.0.0.1' });

    const mind = await client.addMind('C:\\agents\\dude');

    expect(mind.mindId).toBe('dude-1234');
    expect(fetch).toHaveBeenCalledWith(new URL('/api/mind/add', 'http://127.0.0.1:3000'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mindPath: 'C:\\agents\\dude' }),
    }));
  });

  it('sends chat through the loopback server', async () => {
    const client = new ChamberClient({ baseUrl: 'http://127.0.0.1:3000', token: 'token', origin: 'http://127.0.0.1' });

    await client.sendChat({ mindId: 'dude-1234', message: 'Hello', messageId: 'assistant-1' });

    expect(fetch).toHaveBeenCalledWith(new URL('/api/chat/send', 'http://127.0.0.1:3000'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mindId: 'dude-1234', message: 'Hello', messageId: 'assistant-1' }),
    }));
  });
});
