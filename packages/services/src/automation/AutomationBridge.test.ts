import { describe, it, expect, afterEach } from 'vitest';
import { AutomationBridge } from './AutomationBridge';

interface RunningBridge {
  url: string;
  bridge: AutomationBridge;
  stop: () => Promise<void>;
}

const running: RunningBridge[] = [];

afterEach(async () => {
  while (running.length) {
    const r = running.pop();
    if (r) await r.stop();
  }
});

async function startBridge(handlers: {
  onPrompt?: (req: { mindId: string; prompt: string; recipient?: string }) => Promise<{ text: string }>;
  onNotify?: (req: { mindId: string; title: string; body: string }) => Promise<void>;
} = {}): Promise<RunningBridge> {
  const bridge = new AutomationBridge({
    onPrompt: handlers.onPrompt ?? (async () => ({ text: 'queued' })),
    onNotify: handlers.onNotify ?? (async () => {}),
  });
  const started = await bridge.start();
  const r: RunningBridge = { url: started.url, bridge, stop: started.stop };
  running.push(r);
  return r;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('AutomationBridge', () => {
  it('rejects requests without a Bearer token', async () => {
    const r = await startBridge();
    const res = await post(`${r.url}/prompt`, {}, { prompt: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with an unknown Bearer token', async () => {
    const r = await startBridge();
    const res = await post(`${r.url}/prompt`, { authorization: 'Bearer nope' }, { prompt: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects GET requests', async () => {
    const r = await startBridge();
    const res = await fetch(`${r.url}/prompt`);
    expect(res.status).toBe(405);
  });

  it('routes valid /prompt requests to the handler bound to the token mindId', async () => {
    const seen: unknown[] = [];
    const r = await startBridge({
      onPrompt: async (req) => { seen.push(req); return { text: 'ok' }; },
    });
    const minted = r.bridge.tokens.mint('mind-1', 'run-1');
    const res = await post(`${r.url}/prompt`, { authorization: `Bearer ${minted.token}` }, { prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'ok' });
    expect(seen).toEqual([{ mindId: 'mind-1', prompt: 'hello', recipient: undefined }]);
  });

  it('rejects mind-mismatched bodies', async () => {
    const r = await startBridge();
    const minted = r.bridge.tokens.mint('mind-1', 'run-1');
    const res = await post(
      `${r.url}/prompt`,
      { authorization: `Bearer ${minted.token}` },
      { mindId: 'mind-2', prompt: 'hello' },
    );
    expect(res.status).toBe(403);
  });

  it('requires a non-empty prompt string', async () => {
    const r = await startBridge();
    const minted = r.bridge.tokens.mint('mind-1', 'run-1');
    const res = await post(`${r.url}/prompt`, { authorization: `Bearer ${minted.token}` }, { prompt: '' });
    expect(res.status).toBe(400);
  });

  it('routes /notify with title+body and returns ok', async () => {
    const seen: unknown[] = [];
    const r = await startBridge({ onNotify: async (req) => { seen.push(req); } });
    const minted = r.bridge.tokens.mint('mind-1', 'run-1');
    const res = await post(
      `${r.url}/notify`,
      { authorization: `Bearer ${minted.token}` },
      { title: 'Hi', body: 'There' },
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ mindId: 'mind-1', title: 'Hi', body: 'There' }]);
  });

  it('returns 404 for unknown routes', async () => {
    const r = await startBridge();
    const minted = r.bridge.tokens.mint('mind-1', 'run-1');
    const res = await post(`${r.url}/garbage`, { authorization: `Bearer ${minted.token}` }, {});
    expect(res.status).toBe(404);
  });
});
