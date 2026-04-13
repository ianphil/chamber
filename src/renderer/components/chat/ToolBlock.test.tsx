/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolBlock } from './ToolBlock';
import { makeToolCallBlock } from '@/test/helpers';

describe('ToolBlock', () => {
  it('shows tool name', () => {
    render(<ToolBlock block={makeToolCallBlock({ toolName: 'grep' })} />);
    expect(screen.getByText('grep')).toBeTruthy();
  });

  it('shows running status badge', () => {
    render(<ToolBlock block={makeToolCallBlock({ status: 'running' })} />);
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('shows done status badge', () => {
    render(<ToolBlock block={makeToolCallBlock({ status: 'done' })} />);
    expect(screen.getByText('done')).toBeTruthy();
  });

  it('shows error status badge', () => {
    render(<ToolBlock block={makeToolCallBlock({ status: 'error' })} />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders output text when present', () => {
    render(<ToolBlock block={makeToolCallBlock({ output: 'search results here' })} />);
    // Content is inside a collapsible — click trigger to open
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('search results here')).toBeTruthy();
  });

  it('renders error text when present', () => {
    render(<ToolBlock block={makeToolCallBlock({ error: 'command failed' })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('command failed')).toBeTruthy();
  });
});
