/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AzureSpeechToken } from '@chamber/shared/types';
import {
  useVoiceInput,
  type VoiceRecognizer,
  type VoiceRecognizerCallbacks,
} from './useVoiceInput';

const TOKEN: AzureSpeechToken = { token: 'tok', region: 'eastus', expiresAt: Date.now() + 60_000 };

function makeFakeRecognizer() {
  const callbacks: { current: VoiceRecognizerCallbacks | null } = { current: null };
  const start = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const dispose = vi.fn<() => void>();
  const setAuthToken = vi.fn<(token: string) => void>();
  const recognizer: VoiceRecognizer = { start, stop, dispose, setAuthToken };
  const factory = vi.fn(
    (_token: string, _region: string, _language: string | undefined, cb: VoiceRecognizerCallbacks) => {
      callbacks.current = cb;
      return recognizer;
    },
  );
  return { start, stop, dispose, setAuthToken, factory, callbacks };
}

describe('useVoiceInput', () => {
  it('mints a token and starts listening', async () => {
    const { start, factory } = makeFakeRecognizer();
    const mintToken = vi.fn().mockResolvedValue(TOKEN);
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      language: 'en-US',
      mintToken,
      createRecognizer: factory,
    }));

    await act(async () => { await result.current.start(); });

    expect(mintToken).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith('tok', 'eastus', 'en-US', expect.any(Object));
    expect(start).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(true);
    expect(result.current.status).toBe('listening');
  });

  it('surfaces partial transcripts and clears them on final', async () => {
    const onFinalTranscript = vi.fn();
    const fake = makeFakeRecognizer();
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript,
      mintToken: vi.fn().mockResolvedValue(TOKEN),
      createRecognizer: fake.factory,
    }));

    await act(async () => { await result.current.start(); });

    act(() => { fake.callbacks.current!.onPartial('hello wor'); });
    expect(result.current.partialText).toBe('hello wor');

    act(() => { fake.callbacks.current!.onFinal('hello world'); });
    expect(result.current.partialText).toBe('');
    expect(onFinalTranscript).toHaveBeenCalledWith('hello world');
  });

  it('stops and disposes the recognizer', async () => {
    const { stop, dispose, factory } = makeFakeRecognizer();
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken: vi.fn().mockResolvedValue(TOKEN),
      createRecognizer: factory,
    }));

    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });

    expect(stop).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('reports an error when the token cannot be minted', async () => {
    const { factory } = makeFakeRecognizer();
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken: vi.fn().mockResolvedValue(null),
      createRecognizer: factory,
    }));

    await act(async () => { await result.current.start(); });

    expect(factory).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/not configured/i);
  });

  it('reports recognizer errors and stops listening', async () => {
    const fake = makeFakeRecognizer();
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken: vi.fn().mockResolvedValue(TOKEN),
      createRecognizer: fake.factory,
    }));

    await act(async () => { await result.current.start(); });
    act(() => { fake.callbacks.current!.onError('mic exploded'); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('mic exploded');
    expect(result.current.isListening).toBe(false);
    expect(fake.dispose).toHaveBeenCalledOnce();
  });

  it('toggle starts then stops', async () => {
    const { stop, factory } = makeFakeRecognizer();
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken: vi.fn().mockResolvedValue(TOKEN),
      createRecognizer: factory,
    }));

    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(result.current.isListening).toBe(true));

    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(result.current.isListening).toBe(false));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports a starting status while the token is being minted', async () => {
    const { factory } = makeFakeRecognizer();
    let resolveMint!: (token: AzureSpeechToken) => void;
    const mintToken = vi.fn(() => new Promise<AzureSpeechToken>((resolve) => { resolveMint = resolve; }));
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken,
      createRecognizer: factory,
    }));

    let startPromise!: Promise<void>;
    act(() => { startPromise = result.current.start(); });
    expect(result.current.status).toBe('starting');
    expect(result.current.isListening).toBe(false);

    await act(async () => { resolveMint(TOKEN); await startPromise; });
    expect(result.current.status).toBe('listening');
  });

  it('refreshes the auth token before it expires and pushes it to the live recognizer', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeRecognizer();
      const first: AzureSpeechToken = { token: 'tok-1', region: 'eastus', expiresAt: Date.now() + 9 * 60_000 };
      const second: AzureSpeechToken = { token: 'tok-2', region: 'eastus', expiresAt: Date.now() + 18 * 60_000 };
      const mintToken = vi.fn<() => Promise<AzureSpeechToken | null>>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const { result } = renderHook(() => useVoiceInput({
        onFinalTranscript: vi.fn(),
        mintToken,
        createRecognizer: fake.factory,
      }));

      await act(async () => { await result.current.start(); });
      expect(mintToken).toHaveBeenCalledOnce();

      // Advance to the scheduled refresh (expiry minus the 60s skew).
      await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000 - 60_000); });

      expect(mintToken).toHaveBeenCalledTimes(2);
      expect(fake.setAuthToken).toHaveBeenCalledWith('tok-2');
      expect(result.current.status).toBe('listening');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops refreshing the token after stop', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeRecognizer();
      const token: AzureSpeechToken = { token: 'tok', region: 'eastus', expiresAt: Date.now() + 9 * 60_000 };
      const mintToken = vi.fn<() => Promise<AzureSpeechToken | null>>().mockResolvedValue(token);
      const { result } = renderHook(() => useVoiceInput({
        onFinalTranscript: vi.fn(),
        mintToken,
        createRecognizer: fake.factory,
      }));

      await act(async () => { await result.current.start(); });
      await act(async () => { await result.current.stop(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000); });

      expect(mintToken).toHaveBeenCalledOnce();
      expect(fake.setAuthToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a toggle while a start is already in flight', async () => {
    const { factory } = makeFakeRecognizer();
    let resolveMint!: (token: AzureSpeechToken) => void;
    const mintToken = vi.fn(() => new Promise<AzureSpeechToken>((resolve) => { resolveMint = resolve; }));
    const { result } = renderHook(() => useVoiceInput({
      onFinalTranscript: vi.fn(),
      mintToken,
      createRecognizer: factory,
    }));

    let startPromise!: Promise<void>;
    act(() => { startPromise = result.current.start(); });
    expect(result.current.status).toBe('starting');

    act(() => { result.current.toggle(); });

    await act(async () => { resolveMint(TOKEN); await startPromise; });
    expect(mintToken).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('listening');
  });
});
