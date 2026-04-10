/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TypeWriter } from './TypeWriter';

describe('TypeWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('progressively reveals text character by character', () => {
    render(<TypeWriter text="Hello" speed={50} />);

    // After one tick, first char should appear
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText(/^H/)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText(/^He/)).toBeTruthy();
  });

  it('calls onComplete when done', () => {
    const onComplete = vi.fn();
    render(<TypeWriter text="Hi" speed={50} onComplete={onComplete} />);

    // Two ticks for two characters
    act(() => { vi.advanceTimersByTime(100); });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('shows cursor while animating', () => {
    const { container } = render(<TypeWriter text="Hello" speed={50} cursor={true} />);

    // Before completion, cursor should be visible
    act(() => { vi.advanceTimersByTime(50); });
    expect(container.textContent).toContain('▊');
  });

  it('hides cursor after completion', () => {
    const { container } = render(<TypeWriter text="Hi" speed={50} cursor={true} />);

    // Complete all characters
    act(() => { vi.advanceTimersByTime(100); });
    expect(container.textContent).not.toContain('▊');
  });
});
