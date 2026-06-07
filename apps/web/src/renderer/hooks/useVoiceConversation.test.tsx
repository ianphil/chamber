// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVoiceConversation } from './useVoiceConversation';
import type {
  VoiceSynthesizer,
  VoiceSynthesizerCallbacks,
  VoiceSynthesizerFactory,
} from './useVoiceConversation';
import type {
  VoiceRecognizer,
  VoiceRecognizerCallbacks,
  VoiceRecognizerFactory,
} from './useVoiceInput';
import type { AzureSpeechToken } from '@chamber/shared/types';

function makeToken(): AzureSpeechToken {
  return { token: 'tok', region: 'eastus', expiresAt: Date.now() + 600_000 };
}

function makeFakeRecognizer() {
  const start = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const dispose = vi.fn<() => void>();
  const setAuthToken = vi.fn<(token: string) => void>();
  const recognizer: VoiceRecognizer = { start, stop, dispose, setAuthToken };
  let captured: VoiceRecognizerCallbacks | undefined;
  const factory: VoiceRecognizerFactory = (_token, _region, _lang, callbacks) => {
    captured = callbacks;
    return recognizer;
  };
  return {
    start,
    stop,
    dispose,
    setAuthToken,
    recognizer,
    factory,
    get callbacks(): VoiceRecognizerCallbacks {
      if (!captured) throw new Error('recognizer not created yet');
      return captured;
    },
  };
}

function makeFakeSynthesizer(options: { manual?: boolean } = {}) {
  const spoken: string[] = [];
  const resolvers: Array<() => void> = [];
  const speak = vi.fn<(text: string) => Promise<void>>((text) => {
    spoken.push(text);
    if (options.manual) {
      return new Promise<void>((resolve) => resolvers.push(resolve));
    }
    return Promise.resolve();
  });
  const stop = vi.fn<() => void>();
  const dispose = vi.fn<() => void>();
  const setAuthToken = vi.fn<(token: string) => void>();
  const synthesizer: VoiceSynthesizer = { speak, stop, dispose, setAuthToken };
  let captured: VoiceSynthesizerCallbacks | undefined;
  const factory: VoiceSynthesizerFactory = (_token, _region, _voice, callbacks) => {
    captured = callbacks;
    return synthesizer;
  };
  const resolveNext = async () => {
    const next = resolvers.shift();
    if (next) next();
    await Promise.resolve();
  };
  return {
    speak,
    stop,
    dispose,
    setAuthToken,
    synthesizer,
    factory,
    spoken,
    resolveNext,
    get callbacks(): VoiceSynthesizerCallbacks {
      if (!captured) throw new Error('synthesizer not created yet');
      return captured;
    },
  };
}

function setup(overrides: { manual?: boolean } = {}) {
  const recognizer = makeFakeRecognizer();
  const synthesizer = makeFakeSynthesizer({ manual: overrides.manual });
  const mintToken = vi.fn<() => Promise<AzureSpeechToken | null>>(() => Promise.resolve(makeToken()));
  const onUtterance = vi.fn<(text: string) => void>();
  const rendered = renderHook(() => useVoiceConversation({
    onUtterance,
    mintToken,
    createRecognizer: recognizer.factory,
    createSynthesizer: synthesizer.factory,
  }));
  return { recognizer, synthesizer, mintToken, onUtterance, ...rendered };
}

describe('useVoiceConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts listening after minting a token and opening recognizer + synthesizer', async () => {
    const { result, recognizer, synthesizer, mintToken } = setup();

    await act(async () => {
      await result.current.start();
    });

    expect(mintToken).toHaveBeenCalledOnce();
    expect(recognizer.start).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('listening');
    expect(result.current.isActive).toBe(true);
    // synthesizer created but not yet asked to speak
    expect(synthesizer.speak).not.toHaveBeenCalled();
  });

  it('forwards a finalized utterance and moves to thinking', async () => {
    const { result, recognizer, onUtterance } = setup();
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      recognizer.callbacks.onFinal('what is the weather');
    });

    expect(onUtterance).toHaveBeenCalledWith('what is the weather');
    expect(result.current.status).toBe('thinking');
    expect(result.current.partialText).toBe('');
  });

  it('ignores utterances captured while not listening', async () => {
    const { result, recognizer, onUtterance } = setup();
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      recognizer.callbacks.onFinal('first');
    });
    // status is now 'thinking'; a second final should be dropped
    await act(async () => {
      recognizer.callbacks.onFinal('echo of the reply');
    });

    expect(onUtterance).toHaveBeenCalledTimes(1);
    expect(onUtterance).toHaveBeenCalledWith('first');
  });

  it('speaks completed sentences from the streaming reply', async () => {
    const { result, synthesizer } = setup();
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      result.current.updateReply('Hello there. How are you');
    });

    expect(synthesizer.spoken).toEqual(['Hello there.']);
  });

  it('flushes the trailing fragment and resumes listening on endReply', async () => {
    const { result, synthesizer } = setup();
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      result.current.updateReply('A complete sentence. Tail without terminator');
    });
    expect(synthesizer.spoken).toEqual(['A complete sentence.']);

    await act(async () => {
      result.current.endReply();
    });

    expect(synthesizer.spoken).toEqual(['A complete sentence.', 'Tail without terminator']);
    await waitFor(() => expect(result.current.status).toBe('listening'));
  });

  it('holds speaking between chunks while the reply is still streaming', async () => {
    const { result, synthesizer } = setup({ manual: true });
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      result.current.updateReply('Speaking now. ');
    });
    expect(result.current.status).toBe('speaking');

    await act(async () => {
      await synthesizer.resolveNext();
    });
    // The reply has not ended, so more sentences may still arrive. Status must
    // stay 'speaking' rather than strobing to 'thinking' between chunks.
    expect(result.current.status).toBe('speaking');
  });

  it('errors when no token is configured', async () => {
    const recognizer = makeFakeRecognizer();
    const synthesizer = makeFakeSynthesizer();
    const { result } = renderHook(() => useVoiceConversation({
      onUtterance: vi.fn(),
      mintToken: () => Promise.resolve(null),
      createRecognizer: recognizer.factory,
      createSynthesizer: synthesizer.factory,
    }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/not configured/i);
    expect(recognizer.start).not.toHaveBeenCalled();
  });

  it('tears down recognizer and synthesizer on stop', async () => {
    const { result, recognizer, synthesizer } = setup();
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(recognizer.stop).toHaveBeenCalled();
    expect(recognizer.dispose).toHaveBeenCalled();
    expect(synthesizer.dispose).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.isActive).toBe(false);
  });

  it('surfaces a recognizer error and stops the session', async () => {
    const { result, recognizer, synthesizer } = setup();
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      recognizer.callbacks.onError('mic failure');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('mic failure');
    expect(synthesizer.dispose).toHaveBeenCalled();
  });

  it('refreshes the recognizer and synthesizer tokens before expiry', async () => {
    vi.useFakeTimers();
    try {
      const recognizer = makeFakeRecognizer();
      const synthesizer = makeFakeSynthesizer();
      const first: AzureSpeechToken = { token: 'tok-1', region: 'eastus', expiresAt: Date.now() + 9 * 60_000 };
      const second: AzureSpeechToken = { token: 'tok-2', region: 'eastus', expiresAt: Date.now() + 18 * 60_000 };
      const mintToken = vi.fn<() => Promise<AzureSpeechToken | null>>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const { result } = renderHook(() => useVoiceConversation({
        onUtterance: vi.fn(),
        mintToken,
        createRecognizer: recognizer.factory,
        createSynthesizer: synthesizer.factory,
      }));

      await act(async () => {
        await result.current.start();
      });
      expect(mintToken).toHaveBeenCalledOnce();

      await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000 - 60_000); });

      expect(mintToken).toHaveBeenCalledTimes(2);
      expect(recognizer.setAuthToken).toHaveBeenCalledWith('tok-2');
      expect(synthesizer.setAuthToken).toHaveBeenCalledWith('tok-2');
      expect(result.current.status).toBe('listening');
    } finally {
      vi.useRealTimers();
    }
  });
});
