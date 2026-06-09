import { describe, expect, expectTypeOf, it } from 'vitest';

import type { TranscriptionEvent } from '@chamber/shared/voice-types';
import type { TranscriptionProvider } from './types';
import { FAKE_SENTINEL_TRANSCRIPT, FakeTranscriptionProvider } from './FakeTranscriptionProvider';

describe('FakeTranscriptionProvider', () => {
  const immediateClock = (callback: () => void): void => callback();
  const sessionId = 'voice-session-1';

  it('implements the transcription provider contract', () => {
    expectTypeOf<FakeTranscriptionProvider>().toMatchTypeOf<TranscriptionProvider>();
  });

  it('emits a deterministic transcript after the configured chunk count', async () => {
    const provider = new FakeTranscriptionProvider({ chunksUntilFinal: 3, clock: immediateClock });
    const events: TranscriptionEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.start({ sessionId });
    await provider.append(new Uint8Array([1]));
    await provider.append(new Uint8Array([2]));
    await provider.append(new Uint8Array([3]));
    await provider.end();

    expect(events).toEqual([
      { type: 'sessionStarted', sessionId },
      { type: 'partial', sessionId, text: 'hello chamber' },
      { type: 'final', sessionId, text: FAKE_SENTINEL_TRANSCRIPT, isFinal: true },
      { type: 'sessionEnded', sessionId },
    ]);
  });

  it('uses three chunks before the final transcript by default', async () => {
    const provider = new FakeTranscriptionProvider({ clock: immediateClock });
    const events: TranscriptionEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.start({ sessionId });
    await provider.append(new Uint8Array([1]));
    await provider.append(new Uint8Array([2]));
    expect(events.some((event) => event.type === 'final')).toBe(false);

    await provider.append(new Uint8Array([3]));

    expect(events).toContainEqual({ type: 'final', sessionId, text: FAKE_SENTINEL_TRANSCRIPT, isFinal: true });
  });

  it('makes end idempotent and allows a new session afterwards', async () => {
    const provider = new FakeTranscriptionProvider({ chunksUntilFinal: 1, clock: immediateClock });
    const events: TranscriptionEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.start({ sessionId: 'first-session' });
    await provider.end();
    await provider.end();
    await provider.start({ sessionId: 'second-session' });
    await provider.append(new Uint8Array([1]));

    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'first-session' },
      { type: 'sessionEnded', sessionId: 'first-session' },
      { type: 'sessionStarted', sessionId: 'second-session' },
      { type: 'partial', sessionId: 'second-session', text: 'hello chamber' },
      { type: 'final', sessionId: 'second-session', text: FAKE_SENTINEL_TRANSCRIPT, isFinal: true },
    ]);
  });

  it('rejects a second start before the current session ends', async () => {
    const provider = new FakeTranscriptionProvider({ clock: immediateClock });

    await provider.start({ sessionId });

    await expect(provider.start({ sessionId: 'other-session' })).rejects.toThrow(/already started/i);
  });

  it('supports unsubscribing from events', async () => {
    const provider = new FakeTranscriptionProvider({ chunksUntilFinal: 1, clock: immediateClock });
    const events: TranscriptionEvent[] = [];
    const unsubscribe = provider.onEvent((event) => events.push(event));

    unsubscribe();
    await provider.start({ sessionId });
    await provider.append(new Uint8Array([1]));

    expect(events).toEqual([]);
  });
});
