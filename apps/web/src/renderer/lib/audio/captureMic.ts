export interface StartMicCaptureOptions {
  readonly deviceId?: string;
  readonly onFrame: (frame: Float32Array) => void;
}

export interface MicCaptureSession {
  stop: () => Promise<void>;
}

export async function startMicCapture({
  deviceId,
  onFrame,
}: StartMicCaptureOptions): Promise<MicCaptureSession> {
  const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!getUserMedia) {
    throw new Error('Microphone capture is not available in this environment');
  }

  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let workletNode: AudioWorkletNode | undefined;
  let mutedGain: GainNode | undefined;
  let stopped = false;

  const cleanup = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;

    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
    }

    source?.disconnect();
    mutedGain?.disconnect();

    if (audioContext) {
      await audioContext.close();
    }

    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  };

  try {
    stream = await getUserMedia({
      audio: {
        deviceId,
        noiseSuppression: true,
        echoCancellation: true,
      },
    });

    audioContext = new AudioContext({ sampleRate: 48_000 });
    // @ts-expect-error Vite requires the import.meta.url URL pattern for bundling AudioWorklet modules.
    await audioContext.audioWorklet.addModule(new URL('./audioWorklet/pcm16-processor.ts', import.meta.url));

    source = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
    mutedGain = audioContext.createGain();
    mutedGain.gain.value = 0;

    workletNode.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      onFrame(data as Float32Array);
    };

    source.connect(workletNode);
    workletNode.connect(mutedGain);
    mutedGain.connect(audioContext.destination);

    return { stop: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
