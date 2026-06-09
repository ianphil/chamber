/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMicCapture } from './captureMic';

interface MockTrack {
  stop: ReturnType<typeof vi.fn>;
}

interface MockStream {
  getTracks: ReturnType<typeof vi.fn<() => MockTrack[]>>;
}

class MockMediaStreamAudioSourceNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class MockGainNode {
  readonly gain = { value: 1 };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class MockAudioWorkletNode {
  readonly port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null } = { onmessage: null };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    readonly context: MockAudioContext,
    readonly name: string,
  ) {}
}

class MockAudioContext {
  readonly audioWorklet = { addModule: vi.fn<(_: URL) => Promise<void>>().mockResolvedValue(undefined) };
  readonly close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  readonly createMediaStreamSource = vi.fn<(_: MediaStream) => MediaStreamAudioSourceNode>();
  readonly createGain = vi.fn<() => GainNode>();
  readonly destination = {} as AudioDestinationNode;
  readonly sourceNode = new MockMediaStreamAudioSourceNode();
  readonly gainNode = new MockGainNode();

  constructor(readonly options: AudioContextOptions) {
    this.createMediaStreamSource.mockReturnValue(this.sourceNode as unknown as MediaStreamAudioSourceNode);
    this.createGain.mockReturnValue(this.gainNode as unknown as GainNode);
  }
}

const contexts: MockAudioContext[] = [];
const workletNodes: MockAudioWorkletNode[] = [];

describe('startMicCapture', () => {
  let getUserMedia: ReturnType<typeof vi.fn<(_: MediaStreamConstraints) => Promise<MediaStream>>>;
  let track: MockTrack;
  let stream: MockStream;

  beforeEach(() => {
    contexts.length = 0;
    workletNodes.length = 0;

    track = { stop: vi.fn() };
    stream = {
      getTracks: vi.fn(() => [track]),
    };
    getUserMedia = vi.fn().mockResolvedValue(stream as unknown as MediaStream);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    vi.stubGlobal('AudioContext', vi.fn(function AudioContextMock(options: AudioContextOptions) {
      const context = new MockAudioContext(options);
      contexts.push(context);
      return context;
    }));

    vi.stubGlobal('AudioWorkletNode', vi.fn(function AudioWorkletNodeMock(context: MockAudioContext, name: string) {
      const node = new MockAudioWorkletNode(context, name);
      workletNodes.push(node);
      return node;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts microphone capture and forwards worklet frames', async () => {
    const onFrame = vi.fn();
    const session = await startMicCapture({ deviceId: 'mic-1', onFrame });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: 'mic-1',
        noiseSuppression: true,
        echoCancellation: true,
      },
    });
    expect(globalThis.AudioContext).toHaveBeenCalledWith({ sampleRate: 48_000 });
    expect(contexts[0].options).toEqual({ sampleRate: 48_000 });
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledTimes(1);

    const moduleUrl = contexts[0].audioWorklet.addModule.mock.calls[0][0];
    expect(moduleUrl).toBeInstanceOf(URL);
    expect(moduleUrl.href).toContain('/audioWorklet/pcm16-processor.ts');
    expect(globalThis.AudioWorkletNode).toHaveBeenCalledWith(contexts[0], 'pcm16-processor');
    expect(contexts[0].createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(contexts[0].sourceNode.connect).toHaveBeenCalledWith(workletNodes[0]);
    expect(workletNodes[0].connect).toHaveBeenCalledWith(contexts[0].gainNode);
    expect(contexts[0].gainNode.connect).toHaveBeenCalledWith(contexts[0].destination);

    const frame = new Float32Array([0.1, 0.2]);
    workletNodes[0].port.onmessage?.({ data: frame } as MessageEvent<Float32Array>);

    expect(onFrame).toHaveBeenCalledWith(frame);

    await session.stop();

    expect(workletNodes[0].disconnect).toHaveBeenCalledTimes(1);
    expect(contexts[0].sourceNode.disconnect).toHaveBeenCalledTimes(1);
    expect(contexts[0].gainNode.disconnect).toHaveBeenCalledTimes(1);
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('propagates getUserMedia errors', async () => {
    const error = new Error('permission denied');
    getUserMedia.mockRejectedValue(error);

    await expect(startMicCapture({ onFrame: vi.fn() })).rejects.toThrow('permission denied');

    expect(contexts).toHaveLength(0);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('cleans up the stream and AudioContext when worklet loading fails', async () => {
    const error = new Error('worklet failed');

    vi.stubGlobal('AudioContext', vi.fn(function AudioContextMock(options: AudioContextOptions) {
      const context = new MockAudioContext(options);
      context.audioWorklet.addModule.mockRejectedValue(error);
      contexts.push(context);
      return context;
    }));

    await expect(startMicCapture({ onFrame: vi.fn() })).rejects.toThrow('worklet failed');

    expect(contexts[0].close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
