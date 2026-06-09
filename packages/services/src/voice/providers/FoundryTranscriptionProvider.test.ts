import { describe, expect, it, vi } from 'vitest';

import type { TranscriptionEvent, VoiceWorkerRpcRequest, VoiceWorkerRpcResponse } from '@chamber/shared/voice-types';
import { VOICE_DICTATION_MODEL_ID } from '@chamber/shared/voice-types';
import { FoundryTranscriptionProvider } from './FoundryTranscriptionProvider';

class MockVoiceWorkerPool {
  readonly sendEngine = vi.fn(async (request: VoiceWorkerRpcRequest): Promise<VoiceWorkerRpcResponse> => ({
    requestId: request.requestId,
    verb: request.verb,
    ok: true,
  }));
  private engineListener: ((event: TranscriptionEvent) => void) | null = null;
  readonly onEngineEvent = vi.fn((cb: (event: TranscriptionEvent) => void) => {
    this.engineListener = cb;
    return () => {
      this.engineListener = null;
    };
  });

  emit(event: TranscriptionEvent): void {
    this.engineListener?.(event);
  }
}

describe('FoundryTranscriptionProvider', () => {
  it('forwards start, append, and end through the voice engine worker with the active session id', async () => {
    const pool = new MockVoiceWorkerPool();
    const provider = new FoundryTranscriptionProvider(pool);
    const pcm = new Uint8Array([1, 2, 3]);

    await provider.start({ sessionId: 'session-1' });
    await provider.append(pcm);
    await provider.end();

    expect(pool.sendEngine).toHaveBeenNthCalledWith(1, expect.objectContaining({
      verb: 'start',
      sessionId: 'session-1',
      modelId: VOICE_DICTATION_MODEL_ID,
      requestId: expect.any(String),
    }));
    expect(pool.sendEngine).toHaveBeenNthCalledWith(2, expect.objectContaining({
      verb: 'append',
      sessionId: 'session-1',
      pcm,
      requestId: expect.any(String),
    }));
    expect(pool.sendEngine).toHaveBeenNthCalledWith(3, expect.objectContaining({
      verb: 'end',
      sessionId: 'session-1',
      requestId: expect.any(String),
    }));
  });

  it('filters pool events to the active session id', async () => {
    const pool = new MockVoiceWorkerPool();
    const provider = new FoundryTranscriptionProvider(pool);
    const events: TranscriptionEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.start({ sessionId: 'session-1' });
    pool.emit({ type: 'partial', sessionId: 'other-session', text: 'ignored' });
    pool.emit({ type: 'partial', sessionId: 'session-1', text: 'hello' });
    await provider.end();
    pool.emit({ type: 'final', sessionId: 'session-1', text: 'late', isFinal: true });

    expect(events).toEqual([{ type: 'partial', sessionId: 'session-1', text: 'hello' }]);
  });

  it('clears the active session when start fails', async () => {
    const pool = new MockVoiceWorkerPool();
    pool.sendEngine.mockResolvedValueOnce({ requestId: 'request-1', verb: 'start', ok: false, error: 'model missing' });
    const provider = new FoundryTranscriptionProvider(pool);

    await expect(provider.start({ sessionId: 'session-1' })).rejects.toThrow('model missing');
    await provider.start({ sessionId: 'session-2' });

    expect(pool.sendEngine).toHaveBeenLastCalledWith(expect.objectContaining({
      verb: 'start',
      sessionId: 'session-2',
    }));
  });

  it('rejects append before start', async () => {
    const pool = new MockVoiceWorkerPool();
    const provider = new FoundryTranscriptionProvider(pool);

    await expect(provider.append(new Uint8Array())).rejects.toThrow(/no active/i);
    expect(pool.sendEngine).not.toHaveBeenCalled();
  });

  it('supports unsubscribing from provider and pool events', async () => {
    const pool = new MockVoiceWorkerPool();
    const provider = new FoundryTranscriptionProvider(pool);
    const events: TranscriptionEvent[] = [];
    const unsubscribe = provider.onEvent((event) => events.push(event));

    await provider.start({ sessionId: 'session-1' });
    unsubscribe();
    pool.emit({ type: 'partial', sessionId: 'session-1', text: 'ignored' });
    provider.dispose();
    pool.emit({ type: 'partial', sessionId: 'session-1', text: 'also ignored' });

    expect(events).toEqual([]);
  });
});
