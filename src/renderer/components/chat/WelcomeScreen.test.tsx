/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  it('renders "How can I help you today?" when connected', () => {
    render(<WelcomeScreen onSendMessage={vi.fn()} connected={true} />);
    expect(screen.getByText('How can I help you today?')).toBeTruthy();
  });

  it('renders prompt buttons when connected (6 buttons)', () => {
    render(<WelcomeScreen onSendMessage={vi.fn()} connected={true} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
  });

  it('clicking a starter prompt calls onSendMessage with the prompt text', () => {
    const onSendMessage = vi.fn();
    render(<WelcomeScreen onSendMessage={onSendMessage} connected={true} />);
    fireEvent.click(screen.getByText('Daily briefing'));
    expect(onSendMessage).toHaveBeenCalledWith('Give me my daily report');
  });

  it('renders "Select a mind directory" when not connected', () => {
    render(<WelcomeScreen onSendMessage={vi.fn()} connected={false} />);
    expect(screen.getByText(/Select a mind directory/)).toBeTruthy();
  });

  it('does not render prompt buttons when not connected', () => {
    render(<WelcomeScreen onSendMessage={vi.fn()} connected={false} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
