/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamingMessage } from './StreamingMessage';
import { makeTextBlock } from '@/test/helpers';

// Companion file to StreamingMessage.test.tsx that does NOT stub react-markdown,
// so we can assert the actual rendered DOM for fenced code blocks and GFM tables.

describe('StreamingMessage markdown chrome', () => {
  it('renders fenced code blocks with language label and copy button', () => {
    const md = '```json\n{"hello":"world"}\n```';
    render(<StreamingMessage blocks={[makeTextBlock(md)]} />);

    // Language label.
    expect(screen.getByText('json')).toBeTruthy();
    // Copy button is keyboard-accessible.
    const copyBtn = screen.getByRole('button', { name: 'Copy code' });
    expect(copyBtn).toBeTruthy();
    // Code content survives the chrome.
    expect(screen.getByText(/"hello"/)).toBeTruthy();
  });

  it('wraps GFM tables in a horizontally scrollable container with zebra rows', () => {
    const md = [
      '| col a | col b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ].join('\n');

    const { container } = render(<StreamingMessage blocks={[makeTextBlock(md)]} />);
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
    // Zebra striping is applied to <tr>s via even:bg-muted/20.
    const rows = container.querySelectorAll('tr');
    expect(rows.length).toBeGreaterThan(0);
    expect(Array.from(rows).some((r) => r.className.includes('even:bg-muted'))).toBe(true);
  });
});
