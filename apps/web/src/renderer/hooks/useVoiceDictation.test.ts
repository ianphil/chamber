/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE_DICTATION_MODEL_ID, type TranscriptionEvent, type VoiceDictationConfig } from '@chamber/shared/voice-types';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { startMicCapture } from '../lib/audio/captureMic';
import { useVoiceDictation } from './useVoiceDictation';
import { FAKE_SENTINEL_TRANSCRIPT } from '../../../../../packages/services/src/voice/providers/FakeTranscriptionProvider';

vi.mock('../lib/audio/captureMic', () => ({
  startMicCapture: vi.fn(),
}));

const defaultConfig: VoiceDictationConfig = {
  enabled: true,
  inputDeviceId: null,
  shortcut: 'Alt+Shift+V',
  pushToTalk: true,
  model: {
    id: VOICE_DICTATION_MODEL_ID,
  },
};

function shortcutEvent(type: 'keydown' | 'keyup', options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, {
    key: 'V',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    ...options,
  });
}

describe('useVoiceDictation', () => {
  let api: ReturnType<typeof mockElectronAPI>;
  let transcriptCallback: ((event: TranscriptionEvent) => void) | undefined;
  let unsubscribeTranscript: ReturnType<typeof vi.fn<() => void>>;
  let stopCapture: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let onFinalTranscript: ReturnType<typeof vi.fn<(text: string) => void>>;
  let onPartialTranscript: ReturnType<typeof vi.fn<(text: string) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    transcriptCallback = undefined;
    unsubscribeTranscript = vi.fn<() => void>();
    stopCapture = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    onFinalTranscript = vi.fn<(text: string) => void>();
    onPartialTranscript = vi.fn<(text: string) => void>();

    api = installElectronAPI();
    vi.mocked(api.voice.getPermissionState).mockResolvedValue('granted');
    vi.mocked(api.voice.getConfig).mockResolvedValue(defaultConfig);
    vi.mocked(api.voice.getModelStatus).mockResolvedValue({
      id: VOICE_DICTATION_MODEL_ID,
      status: 'ready',
    });
    vi.mocked(api.voice.onTranscript).mockImplementation((callback) => {
      transcriptCallback = callback;
      return () => unsubscribeTranscript();
    });
    vi.mocked(startMicCapture).mockImplementation(async ({ onFrame }) => {
      onFrame(new Float32Array([0, 0.25, -0.25]));
      return { stop: stopCapture };
    });
  });

  it('starts listening and forwards final transcripts for the active session only', async () => {
    const { result } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      onFinalTranscript,
      onPartialTranscript,
    }));

    await waitFor(() => {
      expect(api.voice.onTranscript).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.state).toBe('listening');
    });

    const sessionId = result.current.__currentSessionId;
    expect(sessionId).toEqual(expect.any(String));
    expect(api.voice.startSession).toHaveBeenCalledWith({
      sessionId,
      modelId: VOICE_DICTATION_MODEL_ID,
    });
    await waitFor(() => {
      expect(api.voice.appendAudio).toHaveBeenCalledWith({
        sessionId,
        chunk: expect.any(Uint8Array),
      });
    });

    act(() => {
      transcriptCallback?.({
        type: 'final',
        sessionId: sessionId!,
        text: FAKE_SENTINEL_TRANSCRIPT,
        isFinal: true,
      });
    });

    expect(onFinalTranscript).toHaveBeenCalledWith(FAKE_SENTINEL_TRANSCRIPT);
  });

  it('ignores stale transcript events from other sessions', async () => {
    const { result } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      onFinalTranscript,
      onPartialTranscript,
    }));

    await waitFor(() => {
      expect(api.voice.onTranscript).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      transcriptCallback?.({
        type: 'final',
        sessionId: 'stale-session',
        text: FAKE_SENTINEL_TRANSCRIPT,
        isFinal: true,
      });
      transcriptCallback?.({
        type: 'partial',
        sessionId: 'stale-session',
        text: 'stale partial',
      });
    });

    expect(onFinalTranscript).not.toHaveBeenCalled();
    expect(onPartialTranscript).not.toHaveBeenCalled();
  });

  it('fails start when microphone permission is denied and does not start capture', async () => {
    vi.mocked(api.voice.getPermissionState).mockResolvedValue('denied');

    const { result } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      onFinalTranscript,
    }));

    await waitFor(() => {
      expect(result.current.permission).toBe('denied');
    });

    await act(async () => {
      await expect(result.current.start()).rejects.toThrow(/microphone permission is denied/i);
    });

    expect(api.voice.startSession).not.toHaveBeenCalled();
    expect(startMicCapture).not.toHaveBeenCalled();
    expect(api.voice.onTranscript).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
  });

  it('cleans up an active session on unmount', async () => {
    const addListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { result, unmount } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      onFinalTranscript,
    }));

    await waitFor(() => {
      expect(addListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    await act(async () => {
      await result.current.start();
    });

    const sessionId = result.current.__currentSessionId;
    unmount();

    await waitFor(() => {
      expect(api.voice.endSession).toHaveBeenCalledWith({ sessionId });
    });
    expect(stopCapture).toHaveBeenCalled();
    expect(unsubscribeTranscript).toHaveBeenCalled();
    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('push-to-talk starts on keydown, stops on keyup, and suppresses IME composing events', async () => {
    const { result } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: true,
      onFinalTranscript,
    }));

    await waitFor(() => {
      expect(api.voice.onTranscript).toHaveBeenCalled();
    });

    const composing = shortcutEvent('keydown');
    Object.defineProperty(composing, 'isComposing', { value: true });
    act(() => {
      document.dispatchEvent(composing);
    });

    expect(api.voice.startSession).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(shortcutEvent('keydown'));
    });

    await waitFor(() => {
      expect(result.current.state).toBe('listening');
    });

    const sessionId = result.current.__currentSessionId;

    act(() => {
      document.dispatchEvent(shortcutEvent('keyup'));
    });

    await waitFor(() => {
      expect(api.voice.endSession).toHaveBeenCalledWith({ sessionId });
      expect(result.current.state).toBe('idle');
    });
    expect(stopCapture).toHaveBeenCalled();
  });

  it('toggle mode starts on the first shortcut press and stops on the second', async () => {
    const { result } = renderHook(() => useVoiceDictation({
      enabled: true,
      shortcut: 'Alt+Shift+V',
      pushToTalk: false,
      onFinalTranscript,
    }));

    await waitFor(() => {
      expect(api.voice.onTranscript).toHaveBeenCalled();
    });

    act(() => {
      document.dispatchEvent(shortcutEvent('keydown'));
    });

    await waitFor(() => {
      expect(result.current.state).toBe('listening');
    });

    const sessionId = result.current.__currentSessionId;

    act(() => {
      document.dispatchEvent(shortcutEvent('keydown'));
    });

    await waitFor(() => {
      expect(api.voice.endSession).toHaveBeenCalledWith({ sessionId });
      expect(result.current.state).toBe('idle');
    });
  });
});
