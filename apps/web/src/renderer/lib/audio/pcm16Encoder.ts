export function downsampleFloat32(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (!Number.isFinite(srcRate) || srcRate <= 0) {
    throw new RangeError('srcRate must be a positive finite number');
  }

  if (!Number.isFinite(dstRate) || dstRate <= 0) {
    throw new RangeError('dstRate must be a positive finite number');
  }

  if (input.length === 0) return new Float32Array(0);
  if (srcRate === dstRate) return new Float32Array(input);

  const outputLength = Math.max(1, Math.round((input.length * dstRate) / srcRate));
  const output = new Float32Array(outputLength);
  const ratio = srcRate / dstRate;

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1);
    const mix = sourceIndex - lowerIndex;
    const lower = input[Math.min(lowerIndex, input.length - 1)] ?? 0;
    const upper = input[upperIndex] ?? lower;

    output[i] = lower + ((upper - lower) * mix);
  }

  return output;
}

export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const clamped = Math.min(1, Math.max(-1, input[i] ?? 0));
    output[i] = Math.round(clamped * 32767);
  }

  return output;
}

export function pcm16ToBytes(pcm: Int16Array): Uint8Array {
  const output = new Uint8Array(pcm.length * 2);
  const view = new DataView(output.buffer);

  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(i * 2, pcm[i] ?? 0, true);
  }

  return output;
}

export function chunkPcm16Bytes(bytes: Uint8Array, maxChunkBytes: number): Uint8Array[] {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 2) {
    throw new RangeError('maxChunkBytes must be an integer of at least 2 bytes');
  }

  if ((bytes.byteLength % 2) !== 0) {
    throw new RangeError('PCM16 byte buffers must have an even byte length');
  }

  if (bytes.byteLength === 0) return [];

  const alignedMaxChunkBytes = maxChunkBytes - (maxChunkBytes % 2);
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += alignedMaxChunkBytes) {
    chunks.push(bytes.subarray(offset, Math.min(offset + alignedMaxChunkBytes, bytes.byteLength)));
  }

  return chunks;
}
