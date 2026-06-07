// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceModeOverlay } from './VoiceModeOverlay';

describe('VoiceModeOverlay', () => {
  it('renders the listening status label', () => {
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={() => {}} />);
    expect(screen.getByText('Listening')).toBeTruthy();
  });

  it('shows the live partial transcript', () => {
    render(<VoiceModeOverlay status="listening" partialText="hello there" error={null} onClose={() => {}} />);
    expect(screen.getByText('hello there')).toBeTruthy();
  });

  it('renders the error message in the error state', () => {
    render(<VoiceModeOverlay status="error" partialText="" error="no key configured" onClose={() => {}} />);
    expect(screen.getByText('Voice error')).toBeTruthy();
    expect(screen.getByText('no key configured')).toBeTruthy();
  });

  it('shows the conversation partner name', () => {
    render(<VoiceModeOverlay status="speaking" partialText="" error={null} mindName="Ava" onClose={() => {}} />);
    expect(screen.getByText('with Ava')).toBeTruthy();
  });

  it('invokes onClose from the close button', () => {
    const onClose = vi.fn();
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close voice mode'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose from the end-conversation button', () => {
    const onClose = vi.fn();
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={onClose} />);
    fireEvent.click(screen.getByText('End conversation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the close button on open', () => {
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Close voice mode'));
  });

  it('exposes the error message as an alert without the white-on-white token', () => {
    render(<VoiceModeOverlay status="error" partialText="" error="no key configured" onClose={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('no key configured');
    expect(alert.className).toContain('text-destructive');
    expect(alert.className).not.toContain('text-destructive-foreground');
  });

  it('tells the user the mic is paused while the assistant responds', () => {
    render(<VoiceModeOverlay status="speaking" partialText="" error={null} onClose={() => {}} />);
    expect(screen.getByText('Mic paused while the assistant responds')).toBeTruthy();
  });

  it('does not show the mic-paused hint while listening', () => {
    render(<VoiceModeOverlay status="listening" partialText="" error={null} onClose={() => {}} />);
    expect(screen.queryByText('Mic paused while the assistant responds')).toBeNull();
  });
});
