import type { ContentBlock, TextBlock, ToolCallBlock, ReasoningBlock } from '../../../shared/types';

export type WorkEntry =
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      status: ToolCallBlock['status'];
      preview: string | null;
      block: ToolCallBlock;
    }
  | {
      kind: 'reasoning';
      id: string;
      preview: string | null;
      block: ReasoningBlock;
    };

export type RenderChunk =
  | { kind: 'text'; id: string; block: TextBlock; index: number }
  | { kind: 'work'; id: string; entries: WorkEntry[] };

const PREVIEW_MAX_LEN = 160;

/** First non-empty line, trimmed and truncated. */
export function derivePreview(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) return null;
  return firstLine.length > PREVIEW_MAX_LEN
    ? `${firstLine.slice(0, PREVIEW_MAX_LEN - 1)}…`
    : firstLine;
}

function derivePreviewForTool(block: ToolCallBlock): string | null {
  // Prefer the first positional-looking argument; fall back to output.
  if (block.arguments && Object.keys(block.arguments).length > 0) {
    // Only surface values from a safe allowlist of arg keys. We intentionally
    // do NOT fall back to arbitrary string-valued args because tool calls can
    // carry sensitive data (tokens, api keys, bearer strings, passwords) that
    // was never rendered by the old per-block UI.
    for (const key of [
      'command',
      'cmd',
      'path',
      'file',
      'file_path',
      'filepath',
      'filename',
      'query',
      'url',
      'pattern',
      'glob',
      'search',
      'regex',
    ]) {
      const value = block.arguments[key];
      if (typeof value === 'string') {
        const preview = derivePreview(value);
        if (preview) return preview;
      }
    }
  }
  if (block.output) return derivePreview(block.output);
  if (block.error) return derivePreview(block.error);
  return null;
}

function toolEntry(block: ToolCallBlock): WorkEntry {
  return {
    kind: 'tool',
    id: block.toolCallId,
    toolName: block.toolName,
    status: block.status,
    preview: derivePreviewForTool(block),
    block,
  };
}

function reasoningEntry(block: ReasoningBlock): WorkEntry {
  return {
    kind: 'reasoning',
    id: block.reasoningId,
    preview: derivePreview(block.content),
    block,
  };
}

/**
 * Walk content blocks in order and emit alternating text / work chunks.
 * Consecutive non-text blocks (tool + reasoning) collapse into a single
 * work chunk whose id = first entry's id (stable across streaming appends).
 */
export function groupBlocksIntoChunks(blocks: ReadonlyArray<ContentBlock>): RenderChunk[] {
  const chunks: RenderChunk[] = [];
  let pending: WorkEntry[] | null = null;

  const flushPending = () => {
    if (pending && pending.length > 0) {
      chunks.push({
        kind: 'work',
        id: `work:${pending[0].id}`,
        entries: pending,
      });
    }
    pending = null;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === 'text') {
      flushPending();
      chunks.push({
        kind: 'text',
        id: `text:${i}`,
        block,
        index: i,
      });
      continue;
    }
    if (!pending) pending = [];
    if (block.type === 'tool_call') {
      pending.push(toolEntry(block));
    } else if (block.type === 'reasoning') {
      pending.push(reasoningEntry(block));
    }
  }
  flushPending();

  return chunks;
}

export const MAX_VISIBLE_WORK_ENTRIES = 6;

/**
 * Given a work group's entries, return the slice visible when truncated
 * (last N entries) and the count of hidden entries.
 */
export function truncateWorkEntries(
  entries: ReadonlyArray<WorkEntry>,
  isExpanded: boolean,
  max: number = MAX_VISIBLE_WORK_ENTRIES,
): { visible: ReadonlyArray<WorkEntry>; hiddenCount: number } {
  if (isExpanded || entries.length <= max) {
    return { visible: entries, hiddenCount: 0 };
  }
  return {
    visible: entries.slice(entries.length - max),
    hiddenCount: entries.length - max,
  };
}

/**
 * Label for the work group header. "Tool calls" when all entries are tools,
 * "Work log" when there's at least one reasoning entry mixed in.
 */
export function workGroupLabel(entries: ReadonlyArray<WorkEntry>): string {
  return entries.every((e) => e.kind === 'tool') ? 'Tool calls' : 'Work log';
}
