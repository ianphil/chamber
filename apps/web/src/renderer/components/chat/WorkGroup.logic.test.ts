/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  derivePreview,
  groupBlocksIntoChunks,
  MAX_VISIBLE_WORK_ENTRIES,
  truncateWorkEntries,
  workGroupLabel,
  type WorkEntry,
} from './WorkGroup.logic';
import type { ContentBlock, ToolCallBlock } from '@chamber/shared/types';

function text(content: string): ContentBlock {
  return { type: 'text', content };
}
function tool(id: string, overrides: Partial<ToolCallBlock> = {}): ContentBlock {
  return {
    type: 'tool_call',
    toolCallId: id,
    toolName: 'bash',
    status: 'done',
    ...overrides,
  };
}
function reasoning(id: string, content = 'thinking about it'): ContentBlock {
  return { type: 'reasoning', reasoningId: id, content };
}

describe('derivePreview', () => {
  it('returns null for empty / nullish input', () => {
    expect(derivePreview(null)).toBeNull();
    expect(derivePreview(undefined)).toBeNull();
    expect(derivePreview('')).toBeNull();
    expect(derivePreview('   ')).toBeNull();
    expect(derivePreview('\n\n')).toBeNull();
  });

  it('returns the first non-empty line', () => {
    expect(derivePreview('hello')).toBe('hello');
    expect(derivePreview('\n\nsecond line\nthird')).toBe('second line');
    expect(derivePreview('  padded  ')).toBe('padded');
  });

  it('truncates very long lines with ellipsis', () => {
    const long = 'x'.repeat(500);
    const preview = derivePreview(long);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(160);
    expect(preview!.endsWith('…')).toBe(true);
  });
});

describe('groupBlocksIntoChunks', () => {
  it('returns empty array for no blocks', () => {
    expect(groupBlocksIntoChunks([])).toEqual([]);
  });

  it('emits a text chunk per text block', () => {
    const chunks = groupBlocksIntoChunks([text('a'), text('b')]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].kind).toBe('text');
    expect(chunks[1].kind).toBe('text');
  });

  it('groups consecutive tools + reasoning into a single work chunk', () => {
    const chunks = groupBlocksIntoChunks([
      tool('tc-1'),
      reasoning('r-1'),
      tool('tc-2'),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('work');
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    expect(chunks[0].entries.map((e) => e.id)).toEqual(['tc-1', 'r-1', 'tc-2']);
  });

  it('splits work groups when separated by a text block', () => {
    const chunks = groupBlocksIntoChunks([
      text('intro'),
      tool('tc-1'),
      tool('tc-2'),
      text('middle'),
      reasoning('r-1'),
    ]);
    expect(chunks.map((c) => c.kind)).toEqual(['text', 'work', 'text', 'work']);
    if (chunks[1].kind !== 'work') throw new Error('unreachable');
    expect(chunks[1].entries.map((e) => e.id)).toEqual(['tc-1', 'tc-2']);
    if (chunks[3].kind !== 'work') throw new Error('unreachable');
    expect(chunks[3].entries.map((e) => e.id)).toEqual(['r-1']);
  });

  it('gives work group a stable id derived from its first entry', () => {
    const first = groupBlocksIntoChunks([tool('tc-1'), tool('tc-2')]);
    const appended = groupBlocksIntoChunks([tool('tc-1'), tool('tc-2'), tool('tc-3')]);
    if (first[0].kind !== 'work' || appended[0].kind !== 'work') throw new Error('unreachable');
    expect(first[0].id).toBe(appended[0].id);
    expect(appended[0].entries).toHaveLength(3);
  });

  it('derives tool preview only from allowlisted argument keys', () => {
    const chunks = groupBlocksIntoChunks([
      tool('tc-1', { arguments: { command: 'ls -la' } }),
      tool('tc-2', { arguments: { path: '/tmp/x' } }),
      tool('tc-3', { arguments: { other: 'fallback value' } }),
    ]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    const entries = chunks[0].entries as WorkEntry[];
    expect(entries[0].preview).toBe('ls -la');
    expect(entries[1].preview).toBe('/tmp/x');
    // Non-allowlisted arg key → no preview (avoids leaking unknown args).
    expect(entries[2].preview).toBeNull();
  });

  it('does not leak sensitive-looking argument values in the preview', () => {
    const chunks = groupBlocksIntoChunks([
      tool('tc-1', { arguments: { token: 'sk-secret-abc123' } }),
      tool('tc-2', { arguments: { apiKey: 'AKIA-SECRET' } }),
      tool('tc-3', { arguments: { password: 'hunter2' } }),
      tool('tc-4', { arguments: { authorization: 'Bearer xyz' } }),
    ]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    const entries = chunks[0].entries as WorkEntry[];
    for (const entry of entries) {
      expect(entry.preview).toBeNull();
    }
  });

  it('falls back to output/error when no args', () => {
    const chunks = groupBlocksIntoChunks([
      tool('tc-1', { output: 'some output\nmore' }),
      tool('tc-2', { status: 'error', error: 'boom' }),
    ]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    const entries = chunks[0].entries as WorkEntry[];
    expect(entries[0].preview).toBe('some output');
    expect(entries[1].preview).toBe('boom');
  });

  it('handles empty reasoning content', () => {
    const chunks = groupBlocksIntoChunks([reasoning('r-1', '')]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    expect(chunks[0].entries[0].preview).toBeNull();
  });
});

describe('truncateWorkEntries', () => {
  const entries: WorkEntry[] = Array.from({ length: 10 }, (_, i) => ({
    kind: 'tool' as const,
    id: `tc-${i}`,
    toolName: 'bash',
    status: 'done' as const,
    preview: null,
    block: {
      type: 'tool_call',
      toolCallId: `tc-${i}`,
      toolName: 'bash',
      status: 'done',
    },
  }));

  it('returns all entries when below threshold', () => {
    const short = entries.slice(0, MAX_VISIBLE_WORK_ENTRIES);
    const result = truncateWorkEntries(short, false);
    expect(result.visible).toHaveLength(short.length);
    expect(result.hiddenCount).toBe(0);
  });

  it('shows last N entries when over threshold and collapsed', () => {
    const result = truncateWorkEntries(entries, false);
    expect(result.visible).toHaveLength(MAX_VISIBLE_WORK_ENTRIES);
    expect(result.hiddenCount).toBe(entries.length - MAX_VISIBLE_WORK_ENTRIES);
    expect(result.visible[0].id).toBe(`tc-${entries.length - MAX_VISIBLE_WORK_ENTRIES}`);
    expect(result.visible[result.visible.length - 1].id).toBe(`tc-${entries.length - 1}`);
  });

  it('shows all entries when expanded', () => {
    const result = truncateWorkEntries(entries, true);
    expect(result.visible).toHaveLength(entries.length);
    expect(result.hiddenCount).toBe(0);
  });
});

describe('workGroupLabel', () => {
  it('says "Tool calls" for all-tool groups', () => {
    const chunks = groupBlocksIntoChunks([tool('tc-1'), tool('tc-2')]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    expect(workGroupLabel(chunks[0].entries)).toBe('Tool calls');
  });

  it('says "Work log" when reasoning is mixed in', () => {
    const chunks = groupBlocksIntoChunks([tool('tc-1'), reasoning('r-1')]);
    if (chunks[0].kind !== 'work') throw new Error('unreachable');
    expect(workGroupLabel(chunks[0].entries)).toBe('Work log');
  });
});
