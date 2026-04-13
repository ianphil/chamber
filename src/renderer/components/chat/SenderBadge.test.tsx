/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SenderBadge } from './SenderBadge';

describe('SenderBadge', () => {
  it('renders sender name', () => {
    render(<SenderBadge name="Agent Q" />);
    expect(screen.getByText('from Agent Q')).toBeTruthy();
  });

  it('renders arrow icon', () => {
    render(<SenderBadge name="Agent Q" />);
    expect(screen.getByText('↪')).toBeTruthy();
  });

  it('applies genesis styling', () => {
    const { container } = render(<SenderBadge name="Q" />);
    const badge = container.firstElementChild;
    if (!badge) throw new Error('expected badge element');
    expect(badge.className).toContain('text-genesis');
  });
});
