/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningBlock } from './ReasoningBlock';
import { makeReasoningBlock } from '@/test/helpers';

describe('ReasoningBlock', () => {
  it('shows "Thinking…" when streaming', () => {
    render(<ReasoningBlock block={makeReasoningBlock('analyzing')} isStreaming={true} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('shows "Thought" when not streaming', () => {
    render(<ReasoningBlock block={makeReasoningBlock('analyzed')} isStreaming={false} />);
    expect(screen.getByText('Thought')).toBeTruthy();
  });

  it('renders reasoning content in collapsible', () => {
    render(<ReasoningBlock block={makeReasoningBlock('deep reasoning here')} />);
    // Content is inside a collapsible — click trigger to open
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('deep reasoning here')).toBeTruthy();
  });
});
