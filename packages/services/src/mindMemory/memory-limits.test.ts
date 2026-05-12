import { describe, expect, it } from 'vitest';

import {
  MAX_ENTRYPOINT_BYTES,
  MAX_ENTRYPOINT_LINES,
  countBytes,
  countLines,
  truncateEntrypoint,
} from './memory-limits';

describe('memory-limits constants', () => {
  it('caps the entrypoint at the SCNS spec limits', () => {
    expect(MAX_ENTRYPOINT_LINES).toBe(200);
    expect(MAX_ENTRYPOINT_BYTES).toBe(25_000);
  });
});

describe('countLines', () => {
  it('returns 0 for an empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('returns 0 for a string containing only a trailing newline', () => {
    expect(countLines('\n')).toBe(0);
  });

  it('returns 1 for a single line with no trailing newline', () => {
    expect(countLines('hello')).toBe(1);
  });

  it('treats a trailing newline as terminator, not as an extra line', () => {
    expect(countLines('hello\n')).toBe(1);
  });

  it('counts interior newlines as separators', () => {
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\nc\n')).toBe(3);
  });
});

describe('countBytes', () => {
  it('returns the UTF-8 byte length of an ASCII string', () => {
    expect(countBytes('hello')).toBe(5);
  });

  it('counts multi-byte UTF-8 characters by their byte length', () => {
    expect(countBytes('héllo')).toBe(6);
    expect(countBytes('🦆')).toBe(4);
  });

  it('returns 0 for an empty string', () => {
    expect(countBytes('')).toBe(0);
  });
});

describe('truncateEntrypoint', () => {
  it('passes empty content through unchanged', () => {
    const result = truncateEntrypoint('');
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('passes content under both limits through unchanged', () => {
    const content = 'one\ntwo\nthree';
    const result = truncateEntrypoint(content);
    expect(result.content).toBe(content);
    expect(result.truncated).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('truncates content that exceeds the line limit and reports a lines warning', () => {
    const content = Array.from({ length: MAX_ENTRYPOINT_LINES + 50 }, (_, i) => `line${i}`).join(
      '\n',
    );
    const result = truncateEntrypoint(content);
    expect(result.truncated).toBe(true);
    expect(result.warning).toBe('<!-- Truncated: exceeded lines limit -->');
    // Resulting content has MAX_ENTRYPOINT_LINES kept lines + the warning line.
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(MAX_ENTRYPOINT_LINES + 1);
    expect(lines[MAX_ENTRYPOINT_LINES]).toBe('<!-- Truncated: exceeded lines limit -->');
  });

  it('truncates content that exceeds the byte limit and reports a bytes warning', () => {
    const oversized = 'x'.repeat(MAX_ENTRYPOINT_BYTES + 100);
    const result = truncateEntrypoint(oversized);
    expect(result.truncated).toBe(true);
    expect(result.warning).toBe('<!-- Truncated: exceeded bytes limit -->');
    expect(countBytes(result.content)).toBeLessThanOrEqual(MAX_ENTRYPOINT_BYTES + 100);
  });

  it('reports both lines and bytes when both limits are exceeded', () => {
    // Many short lines so we trip BOTH gates.
    const content = Array.from({ length: MAX_ENTRYPOINT_LINES + 500 }, () =>
      'a'.repeat(200),
    ).join('\n');
    const result = truncateEntrypoint(content);
    expect(result.truncated).toBe(true);
    expect(result.warning).toBe('<!-- Truncated: exceeded lines and bytes limit -->');
  });

  it('does not split multi-byte sequences when hard-cutting a single oversized line', () => {
    const single = '🦆'.repeat(Math.ceil(MAX_ENTRYPOINT_BYTES / 4) + 50);
    const result = truncateEntrypoint(single);
    expect(result.truncated).toBe(true);
    // The truncated content must be valid UTF-8 (no replacement character at the end).
    expect(result.content).not.toMatch(/\uFFFD$/);
  });
});
