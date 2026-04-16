/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkGroup } from './WorkGroup';
import { groupBlocksIntoChunks, type WorkEntry } from './WorkGroup.logic';
import type { ContentBlock, ToolCallBlock } from '../../../shared/types';

function tool(id: string, overrides: Partial<ToolCallBlock> = {}): ContentBlock {
  return {
    type: 'tool_call',
    toolCallId: id,
    toolName: 'bash',
    status: 'done',
    ...overrides,
  };
}

function entriesFromBlocks(blocks: ContentBlock[]): WorkEntry[] {
  const [chunk] = groupBlocksIntoChunks(blocks);
  if (!chunk || chunk.kind !== 'work') throw new Error('expected work chunk');
  return chunk.entries as WorkEntry[];
}

describe('WorkGroup', () => {
  it('renders all entries with an entry count label', () => {
    const entries = entriesFromBlocks([
      tool('tc-1', { toolName: 'grep' }),
      tool('tc-2', { toolName: 'read_file' }),
      tool('tc-3', { toolName: 'bash' }),
    ]);
    render(<WorkGroup entries={entries} />);
    expect(screen.getByText(/Tool calls \(3\)/)).toBeTruthy();
    expect(screen.getByText('grep')).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('uses the "Work log" label when reasoning is mixed in', () => {
    const blocks: ContentBlock[] = [
      tool('tc-1', { toolName: 'grep' }),
      { type: 'reasoning', reasoningId: 'r-1', content: 'pondering' },
    ];
    const entries = entriesFromBlocks(blocks);
    render(<WorkGroup entries={entries} />);
    expect(screen.getByText(/Work log \(2\)/)).toBeTruthy();
  });

  it('truncates to last 6 entries with a show-more button', () => {
    const blocks: ContentBlock[] = Array.from({ length: 10 }, (_, i) =>
      tool(`tc-${i}`, { toolName: `tool_${i}` }),
    );
    const entries = entriesFromBlocks(blocks);
    render(<WorkGroup entries={entries} />);
    // Newest 6 visible.
    expect(screen.queryByText('tool_0')).toBeNull();
    expect(screen.queryByText('tool_3')).toBeNull();
    expect(screen.getByText('tool_4')).toBeTruthy();
    expect(screen.getByText('tool_9')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Show 4 more/ });
    fireEvent.click(button);
    expect(screen.getByText('tool_0')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show less/ })).toBeTruthy();
  });

  it('expands a tool entry to show its output when clicked', () => {
    const entries = entriesFromBlocks([
      tool('tc-1', { toolName: 'grep', output: 'first-line\nsecond-detail-line' }),
    ]);
    render(<WorkGroup entries={entries} />);
    // Detail-only line hidden initially.
    expect(screen.queryByText(/second-detail-line/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /grep/ }));
    expect(screen.getByText(/second-detail-line/)).toBeTruthy();
  });

  it('auto-expands a running tool when the group is active', () => {
    const entries = entriesFromBlocks([
      tool('tc-1', {
        toolName: 'bash',
        status: 'running',
        output: 'preview-line\ndetail-only-line',
      }),
    ]);
    render(<WorkGroup entries={entries} isActive />);
    expect(screen.getByText(/detail-only-line/)).toBeTruthy();
  });

  it('does not auto-expand when the group is inactive', () => {
    const entries = entriesFromBlocks([
      tool('tc-1', {
        toolName: 'bash',
        status: 'running',
        output: 'preview-line\ndetail-only-line',
      }),
    ]);
    render(<WorkGroup entries={entries} isActive={false} />);
    expect(screen.queryByText(/detail-only-line/)).toBeNull();
  });

  it('does not allow toggling an entry with no detail', () => {
    const entries = entriesFromBlocks([
      tool('tc-1', { toolName: 'grep', status: 'done' }),
    ]);
    render(<WorkGroup entries={entries} />);
    const button = screen.getByRole('button', { name: /grep/ });
    expect(button).toHaveProperty('disabled', true);
  });

  it('auto-expands a running tool even when a reasoning entry trails it', () => {
    const blocks: ContentBlock[] = [
      tool('tc-1', {
        toolName: 'bash',
        status: 'running',
        output: 'preview-line\ndetail-only-line',
      }),
      { type: 'reasoning', reasoningId: 'r-1', content: 'pondering' },
    ];
    const entries = entriesFromBlocks(blocks);
    render(<WorkGroup entries={entries} isActive />);
    // The running tool (not the trailing reasoning) should be auto-expanded.
    expect(screen.getByText(/detail-only-line/)).toBeTruthy();
  });
});
