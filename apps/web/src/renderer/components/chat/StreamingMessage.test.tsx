/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamingMessage } from './StreamingMessage';
import { makeTextBlock, makeToolCallBlock, makeReasoningBlock } from '@/test/helpers';

const markdownMock = vi.fn(({ children }: { children: string }) => <div data-testid="markdown">{children}</div>);

vi.mock('react-markdown', () => ({
  default: (props: { children: string }) => markdownMock(props),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

describe('StreamingMessage', () => {
  beforeEach(() => {
    markdownMock.mockClear();
  });
  it('shows thinking dots when empty blocks and streaming', () => {
    render(<StreamingMessage blocks={[]} isStreaming={true} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('renders text content', () => {
    render(<StreamingMessage blocks={[makeTextBlock('Hello world')]} />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('groups a tool_call block into a WorkGroup', () => {
    const block = makeToolCallBlock({ toolName: 'read_file', status: 'running' });
    render(<StreamingMessage blocks={[block]} />);
    expect(screen.getByText(/Tool calls \(1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tool calls \(1\)/ }));
    expect(screen.getByText('read_file')).toBeTruthy();
  });

  it('groups a reasoning block into a WorkGroup', () => {
    const block = makeReasoningBlock('preview-line\ndetail-only-line');
    render(<StreamingMessage blocks={[block]} />);
    expect(screen.getByText(/Work log \(1\)/)).toBeTruthy();
    expect(screen.queryByText(/detail-only-line/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Work log \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Thought/ }));
    expect(screen.getByText(/detail-only-line/)).toBeTruthy();
  });

  it('splits text and non-text blocks into alternating chunks', () => {
    render(
      <StreamingMessage
        blocks={[
          makeTextBlock('intro'),
          makeToolCallBlock({ toolCallId: 'tc-1', toolName: 'bash' }),
          makeTextBlock('outro'),
        ]}
      />,
    );
    expect(screen.getByText('intro')).toBeTruthy();
    expect(screen.getByText(/Tool calls \(1\)/)).toBeTruthy();
    expect(screen.getByText('outro')).toBeTruthy();
  });

  it('hides trailing indicator when last chunk is an active work group', () => {
    const block = makeToolCallBlock({ toolName: 'grep', status: 'running' });
    const { container } = render(<StreamingMessage blocks={[block]} isStreaming={true} />);
    // No bouncing-dot trailing indicator; the running tool's spinner conveys progress.
    expect(container.querySelector('.animate-bounce')).toBeNull();
  });

  it('still shows trailing indicator when last work chunk has no running tool', () => {
    // Simulates: tool finished, message still streaming before next block arrives.
    const block = makeToolCallBlock({ toolName: 'grep', status: 'done' });
    const { container } = render(<StreamingMessage blocks={[block]} isStreaming={true} />);
    expect(container.querySelector('.animate-bounce')).not.toBeNull();
  });

  it('renders nothing special when not streaming with no blocks', () => {
    const { container } = render(<StreamingMessage blocks={[]} isStreaming={false} />);
    expect(container.querySelector('.animate-bounce')).toBeNull();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('does not re-render Markdown for an unchanged text block when a sibling block updates', () => {
    const stableText = makeTextBlock('alpha');
    const initialTool = makeToolCallBlock({ toolCallId: 'tc-1', toolName: 'grep', status: 'running' });
    const { rerender } = render(<StreamingMessage blocks={[stableText, initialTool]} isStreaming={true} />);
    const callsAfterInitialRender = markdownMock.mock.calls.length;
    expect(callsAfterInitialRender).toBeGreaterThanOrEqual(1);

    const updatedTool = { ...initialTool, status: 'done' as const, output: 'finished' };
    rerender(<StreamingMessage blocks={[stableText, updatedTool]} isStreaming={true} />);

    expect(markdownMock.mock.calls.length).toBe(callsAfterInitialRender);
  });

  it('re-renders Markdown only for the changed text block when one of two text blocks updates', () => {
    const stableText = makeTextBlock('alpha');
    const growingTextV1 = makeTextBlock('beta');
    const tool = makeToolCallBlock({ toolCallId: 'tc-1', toolName: 'grep', status: 'done' });
    const { rerender } = render(<StreamingMessage blocks={[stableText, tool, growingTextV1]} isStreaming={true} />);
    const callsAfterInitialRender = markdownMock.mock.calls.length;

    const growingTextV2 = { ...growingTextV1, content: 'beta-extended' };
    rerender(<StreamingMessage blocks={[stableText, tool, growingTextV2]} isStreaming={true} />);

    expect(markdownMock.mock.calls.length).toBe(callsAfterInitialRender + 1);
  });
});
