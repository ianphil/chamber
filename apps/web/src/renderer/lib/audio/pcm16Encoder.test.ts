import { VOICE_MAX_APPEND_CHUNK_BYTES } from '@chamber/shared/voice-types';
import { describe, expect, it } from 'vitest';
import {
  chunkPcm16Bytes,
  downsampleFloat32,
  float32ToPcm16,
  pcm16ToBytes,
} from './pcm16Encoder';

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples.length);
}

describe('pcm16Encoder', () => {
  describe('downsampleFloat32', () => {
    it('downsamples 48 kHz to 16 kHz using source-rate positions', () => {
      const input = new Float32Array([0, 1, 2, 3, 4, 5]);

      expect(Array.from(downsampleFloat32(input, 48_000, 16_000))).toEqual([0, 3]);
    });

    it('uses linear interpolation for non-integer source positions', () => {
      const input = new Float32Array([0, 10, 20, 30]);
      const output = downsampleFloat32(input, 4, 3);

      expect(output).toHaveLength(3);
      expect(output[0]).toBeCloseTo(0);
      expect(output[1]).toBeCloseTo(13.333333);
      expect(output[2]).toBeCloseTo(26.666667);
    });

    it('preserves sine-wave RMS through 48 kHz to 16 kHz downsampling', () => {
      const sourceRate = 48_000;
      const dstRate = 16_000;
      const frequency = 440;
      const input = new Float32Array(sourceRate);

      for (let i = 0; i < input.length; i++) {
        input[i] = Math.sin((2 * Math.PI * frequency * i) / sourceRate);
      }

      const output = downsampleFloat32(input, sourceRate, dstRate);

      expect(output).toHaveLength(dstRate);
      expect(rms(output)).toBeCloseTo(rms(input), 3);
    });
  });

  describe('float32ToPcm16', () => {
    it('clamps to [-1, 1] and rounds using the 32767 scale factor', () => {
      const input = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]);

      expect(Array.from(float32ToPcm16(input))).toEqual([
        -32767,
        -32767,
        -16383,
        0,
        16384,
        32767,
        32767,
      ]);
    });
  });

  describe('pcm16ToBytes', () => {
    it('returns little-endian PCM16 bytes', () => {
      const pcm = new Int16Array([0x1234, -2, 32767]);

      expect(Array.from(pcm16ToBytes(pcm))).toEqual([
        0x34,
        0x12,
        0xfe,
        0xff,
        0xff,
        0x7f,
      ]);
    });
  });

  describe('chunkPcm16Bytes', () => {
    it('splits chunks on 2-byte boundaries when maxChunkBytes is odd', () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const chunks = chunkPcm16Bytes(bytes, 5);

      expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
      expect(chunks.every((chunk) => (chunk.byteLength % 2) === 0)).toBe(true);
      expect(Array.from(chunks.flatMap((chunk) => Array.from(chunk)))).toEqual(Array.from(bytes));
    });

    it('uses the shared max append size safely for oversize PCM16 payloads', () => {
      const bytes = new Uint8Array(VOICE_MAX_APPEND_CHUNK_BYTES + 2);
      const chunks = chunkPcm16Bytes(bytes, VOICE_MAX_APPEND_CHUNK_BYTES);

      expect(chunks.map((chunk) => chunk.byteLength)).toEqual([VOICE_MAX_APPEND_CHUNK_BYTES, 2]);
      expect(chunks.every((chunk) => chunk.byteLength <= VOICE_MAX_APPEND_CHUNK_BYTES)).toBe(true);
      expect(chunks.every((chunk) => (chunk.byteLength % 2) === 0)).toBe(true);
    });

    it('rejects odd-length PCM16 byte buffers', () => {
      expect(() => chunkPcm16Bytes(new Uint8Array([0, 1, 2]), 64)).toThrow(
        'PCM16 byte buffers must have an even byte length',
      );
    });
  });
});
