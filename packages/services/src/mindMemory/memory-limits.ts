/**
 * MEMORY.md size enforcement — keeps the entrypoint within SCNS-style spec limits.
 *
 * Pure module: no I/O, no logging, no global state.
 */

export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;

export interface TruncateResult {
  readonly content: string;
  readonly truncated: boolean;
  readonly warning: string | null;
}

export function countLines(content: string): number {
  if (content === '') return 0;
  const stripped = content.endsWith('\n') ? content.slice(0, -1) : content;
  if (stripped === '') return 0;
  return stripped.split('\n').length;
}

export function countBytes(content: string): number {
  return Buffer.byteLength(content, 'utf-8');
}

export function truncateEntrypoint(content: string): TruncateResult {
  if (content === '') {
    return { content: '', truncated: false, warning: null };
  }

  const overLines = countLines(content) > MAX_ENTRYPOINT_LINES;
  const overBytes = countBytes(content) > MAX_ENTRYPOINT_BYTES;

  if (!overLines && !overBytes) {
    return { content, truncated: false, warning: null };
  }

  let result = content;
  let hitLines = false;
  let hitBytes = false;

  if (overLines) {
    const lines = result.split('\n');
    result = lines.slice(0, MAX_ENTRYPOINT_LINES).join('\n');
    hitLines = true;
  }

  if (countBytes(result) > MAX_ENTRYPOINT_BYTES) {
    result = truncateToByteLimit(result);
    hitBytes = true;
  }

  const cap = hitLines && hitBytes ? 'lines and bytes' : hitLines ? 'lines' : 'bytes';
  const warning = `<!-- Truncated: exceeded ${cap} limit -->`;

  return {
    content: `${result}\n${warning}`,
    truncated: true,
    warning,
  };
}

function truncateToByteLimit(content: string): string {
  const buf = Buffer.from(content, 'utf-8');
  const sliced = buf.subarray(0, MAX_ENTRYPOINT_BYTES);
  let str = sliced.toString('utf-8');

  const lastNl = str.lastIndexOf('\n');
  if (lastNl > 0) {
    str = str.slice(0, lastNl);
  } else {
    str = Buffer.from(content, 'utf-8').subarray(0, MAX_ENTRYPOINT_BYTES).toString('utf-8');
    if (str.endsWith('\uFFFD')) {
      str = str.slice(0, -1);
    }
  }

  return str;
}
