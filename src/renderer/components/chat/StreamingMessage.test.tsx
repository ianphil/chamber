/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamingMessage } from './StreamingMessage';
import { makeTextBlock, makeToolCallBlock, makeReasoningBlock } from '@/test/helpers';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

describe('StreamingMessage', () => {
  it('shows thinking dots when empty blocks and streaming', () => {
    render(<StreamingMessage blocks={[]} isStreaming={true} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('renders text content', () => {
    render(<StreamingMessage blocks={[makeTextBlock('Hello world')]} />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('renders ToolBlock for tool_call blocks', () => {
    const block = makeToolCallBlock({ toolName: 'read_file', status: 'running' });
    render(<StreamingMessage blocks={[block]} />);
    expect(screen.getByText('read_file')).toBeTruthy();
  });

  it('renders ReasoningBlock for reasoning blocks', () => {
    const block = makeReasoningBlock('considering options');
    render(<StreamingMessage blocks={[block]} />);
    // ReasoningBlock renders inside a collapsible — click to open
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('considering options')).toBeTruthy();
  });

  it('shows trailing indicator when streaming after non-text block', () => {
    const block = makeToolCallBlock({ toolName: 'grep', status: 'done' });
    const { container } = render(<StreamingMessage blocks={[block]} isStreaming={true} />);
    // Trailing indicator has bouncing dots
    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('renders nothing special when not streaming with no blocks', () => {
    const { container } = render(<StreamingMessage blocks={[]} isStreaming={false} />);
    expect(container.querySelector('.animate-bounce')).toBeNull();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });
});
