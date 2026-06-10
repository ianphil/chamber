/**
 * AudioWorklet capture buffer for voice dictation.
 *
 * This processor intentionally posts Float32Array frames at the AudioContext
 * sample rate. Downsample + PCM16 encoding happens on the main renderer thread
 * in B6 using ../pcm16Encoder.ts.
 */

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

const TARGET_SAMPLE_RATE = 16_000;
const TARGET_FRAME_SAMPLES = 1_600;
const FRAME_SECONDS = TARGET_FRAME_SAMPLES / TARGET_SAMPLE_RATE;
const FRAME_SAMPLES = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));

class Pcm16Processor extends AudioWorkletProcessor {
  private readonly frame = new Float32Array(FRAME_SAMPLES);
  private offset = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const sampleCount = input[0].length;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      let sample = 0;

      for (const channel of input) {
        sample += channel[sampleIndex] ?? 0;
      }

      this.frame[this.offset] = sample / input.length;
      this.offset += 1;

      if (this.offset === this.frame.length) {
        const postedFrame = new Float32Array(this.frame);
        this.port.postMessage(postedFrame, [postedFrame.buffer]);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm16-processor', Pcm16Processor);

export {};
