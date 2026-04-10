/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LandingScreen } from './LandingScreen';

describe('LandingScreen', () => {
  it('renders Chamber title', () => {
    render(<LandingScreen onNewAgent={vi.fn()} onOpenExisting={vi.fn()} />);
    expect(screen.getByText('Chamber')).toBeTruthy();
  });

  it('renders New Agent and Open Existing buttons', () => {
    render(<LandingScreen onNewAgent={vi.fn()} onOpenExisting={vi.fn()} />);
    expect(screen.getByText('New Agent')).toBeTruthy();
    expect(screen.getByText('Open Existing')).toBeTruthy();
  });

  it('clicking New Agent calls onNewAgent', () => {
    const onNewAgent = vi.fn();
    render(<LandingScreen onNewAgent={onNewAgent} onOpenExisting={vi.fn()} />);
    fireEvent.click(screen.getByText('New Agent'));
    expect(onNewAgent).toHaveBeenCalledOnce();
  });

  it('clicking Open Existing calls onOpenExisting', () => {
    const onOpenExisting = vi.fn();
    render(<LandingScreen onNewAgent={vi.fn()} onOpenExisting={onOpenExisting} />);
    fireEvent.click(screen.getByText('Open Existing'));
    expect(onOpenExisting).toHaveBeenCalledOnce();
  });
});
