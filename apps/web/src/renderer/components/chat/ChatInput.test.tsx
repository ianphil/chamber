/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import type { ModelInfo } from '../../../shared/types';

const caretCoords = vi.hoisted(() => ({
  current: { top: 100, left: 50, height: 16 },
}));

// jsdom does not provide ResizeObserver; cmdk needs it.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;
// jsdom does not implement Element.scrollIntoView; cmdk calls it on focus.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Stub the textarea-caret util — jsdom returns 0 for layout, so we provide
// stable coordinates that the tests can assert against.
vi.mock('../../lib/textarea-caret', () => ({
  getTextareaCaretCoords: () => caretCoords.current,
}));

const defaultProps = {
  onSend: vi.fn(),
  onStop: vi.fn(),
  isStreaming: false,
  disabled: false,
  availableModels: [] as ModelInfo[],
  selectedModel: null,
  onModelChange: vi.fn(),
};

describe('ChatInput', () => {
  it('typing updates textarea value', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Hello');
  });

  it('Enter key submits non-empty text', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Hello', undefined);
  });

  it('Enter on empty text does not submit', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Shift+Enter does not submit', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disabled prop disables textarea', () => {
    render(<ChatInput {...defaultProps} disabled={true} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveProperty('disabled', true);
  });

  it('streaming shows stop button, clicking calls onStop', () => {
    const onStop = vi.fn();
    render(<ChatInput {...defaultProps} isStreaming={true} onStop={onStop} />);
    // The emoji trigger has aria-label "Insert emoji"; the stop button is the only other button.
    const buttons = screen.getAllByRole('button');
    const stop = buttons.find((b) => b.getAttribute('aria-label') !== 'Insert emoji');
    expect(stop).toBeTruthy();
    fireEvent.click(stop!);
    expect(onStop).toHaveBeenCalled();
  });

  it('shows Loading models when no models available and not disabled', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByText('Loading models…')).toBeTruthy();
  });

  describe('emoji picker', () => {
    it('renders an emoji trigger button with aria-label', () => {
      render(<ChatInput {...defaultProps} />);
      const trigger = screen.getByRole('button', { name: 'Insert emoji' });
      expect(trigger).toBeTruthy();
      expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('disables emoji trigger when disabled prop is true', () => {
      render(<ChatInput {...defaultProps} disabled={true} />);
      const trigger = screen.getByRole('button', { name: 'Insert emoji' });
      expect((trigger as HTMLButtonElement).disabled).toBe(true);
    });

    it('emoji trigger remains enabled while streaming', () => {
      render(<ChatInput {...defaultProps} isStreaming={true} />);
      const trigger = screen.getByRole('button', { name: 'Insert emoji' });
      expect((trigger as HTMLButtonElement).disabled).toBe(false);
    });

    it('emoji trigger toggles aria-expanded on click', () => {
      render(<ChatInput {...defaultProps} />);
      const trigger = screen.getByRole('button', { name: 'Insert emoji' });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('preserves textarea selection when emoji trigger is mousedown', () => {
      render(<ChatInput {...defaultProps} />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'hello world' } });
      textarea.setSelectionRange(5, 5);
      const trigger = screen.getByRole('button', { name: 'Insert emoji' });
      const evt = fireEvent.mouseDown(trigger);
      // preventDefault means default action of moving focus is suppressed
      expect(evt).toBe(false); // fireEvent returns false when preventDefault was called
    });
  });

  describe(':shortcode autocomplete', () => {
    afterEach(() => {
      caretCoords.current = { top: 100, left: 50, height: 16 };
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    });

    function typeWithCaret(textarea: HTMLTextAreaElement, value: string) {
      // Set caret at the end of the new value so detection sees the trailing token.
      Object.defineProperty(textarea, 'selectionStart', { configurable: true, value: value.length });
      Object.defineProperty(textarea, 'selectionEnd', { configurable: true, value: value.length });
      fireEvent.change(textarea, { target: { value } });
    }

    async function expectShortcodeOpen() {
      return await waitFor(() => screen.getByTestId('shortcode-popover'));
    }

    it('opens popover for ":sm" and shows suggestions', async () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':sm');
      await expectShortcodeOpen();
    });

    it('opens shortcode suggestions above the caret when the bottom viewport edge would clip them', async () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 180 });
      caretCoords.current = { top: 150, left: 50, height: 16 };
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':sm');
      const popover = await expectShortcodeOpen();
      expect(popover.style.top).toBe('8px');
      expect(popover.getAttribute('data-side')).toBe('top');
    });

    it('does not open for ":" alone', () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':');
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
    });

    it('does not open for ":30" (no letter)', () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':30');
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
    });

    it('does not open for "12:30" (no boundary before colon)', () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, '12:30am');
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
    });

    it('does not open inside an image token span', () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      // Place caret just after the colon-y char inside a fake image token.
      const value = '[📷 :sm';
      typeWithCaret(ta, value);
      // The token span continues without `]`, so detectShortcode treats the
      // `:sm` as inside the (unclosed) image span. Closed-token case is
      // covered explicitly below.
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
    });

    it('does not open inside a closed image token', () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      // Caret positioned within the `[📷 …]` span via selectionStart override.
      const value = '[📷 :smile.png] after';
      Object.defineProperty(ta, 'selectionStart', { configurable: true, value: 8 });
      Object.defineProperty(ta, 'selectionEnd', { configurable: true, value: 8 });
      fireEvent.change(ta, { target: { value } });
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
    });

    it('Escape closes popover without altering text', async () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':sm');
      await expectShortcodeOpen();
      fireEvent.keyDown(ta, { key: 'Escape' });
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
      expect(ta.value).toBe(':sm');
    });

    it('Enter accepts active suggestion and replaces shortcode token', async () => {
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      await expectShortcodeOpen();
      fireEvent.keyDown(ta, { key: 'Enter' });
      // Should not have submitted the message.
      expect(onSend).not.toHaveBeenCalled();
      // The :smile token should be replaced with an emoji char (not start with ':').
      await waitFor(() => {
        expect(ta.value.startsWith(':')).toBe(false);
        expect(ta.value.length).toBeGreaterThan(0);
      });
    });

    it('Tab also accepts active suggestion', async () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      await expectShortcodeOpen();
      fireEvent.keyDown(ta, { key: 'Tab' });
      await waitFor(() => {
        expect(ta.value.startsWith(':')).toBe(false);
      });
    });

    it('Enter while popover open AND streaming does not call onStop', async () => {
      const onStop = vi.fn();
      render(<ChatInput {...defaultProps} isStreaming={true} onStop={onStop} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      await expectShortcodeOpen();
      fireEvent.keyDown(ta, { key: 'Enter' });
      expect(onStop).not.toHaveBeenCalled();
    });

    it('Shift+Enter does not accept; closes/keeps popover and inserts newline-style behavior', async () => {
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      await expectShortcodeOpen();
      fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
      // Did not submit, and the colon-token is still in the value (not replaced).
      expect(onSend).not.toHaveBeenCalled();
      expect(ta.value).toBe(':smile');
    });

    it('IME composition suppresses popover and Enter', async () => {
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.compositionStart(ta);
      typeWithCaret(ta, ':smile');
      expect(screen.queryByTestId('shortcode-popover')).toBeNull();
      fireEvent.keyDown(ta, { key: 'Enter', isComposing: true });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('typing past the boundary closes the popover', async () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      await expectShortcodeOpen();
      typeWithCaret(ta, ':smile ');
      await waitFor(() => {
        expect(screen.queryByTestId('shortcode-popover')).toBeNull();
      });
    });

    it('clicking a suggestion replaces the token', async () => {
      render(<ChatInput {...defaultProps} />);
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
      typeWithCaret(ta, ':smile');
      const popover = await expectShortcodeOpen();
      const item = popover.querySelector('[data-slot="command-item"]') as HTMLElement;
      expect(item).toBeTruthy();
      // Use mousedown — the handler is on mousedown, not click.
      act(() => {
        fireEvent.mouseDown(item);
      });
      await waitFor(() => {
        expect(ta.value.startsWith(':')).toBe(false);
      });
    });
  });
});
