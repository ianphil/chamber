/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import type { ModelInfo } from '@chamber/shared/types';
import { VOICE_DICTATION_MODEL_ID, type VoiceDictationConfig, type VoiceModelStatus } from '@chamber/shared/voice-types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';

const appStateMock = vi.hoisted(() => ({
  current: {
    featureFlags: {
      switchboardRelay: false,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
    },
  },
}));

const voiceHookMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  state: 'idle',
  permissionState: 'granted',
  latestOptions: null as null | {
    enabled: boolean;
    shortcut: string;
    pushToTalk: boolean;
    onFinalTranscript: (text: string) => void;
  },
}));

vi.mock('../../lib/store', () => ({
  useAppState: () => appStateMock.current,
}));

vi.mock('../../hooks/useVoiceDictation', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    useVoiceDictation: vi.fn((options: NonNullable<typeof voiceHookMock.latestOptions>) => {
      voiceHookMock.latestOptions = options;
      ReactActual.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (!options.enabled || event.repeat || event.isComposing) return;
          if (options.shortcut === 'Alt+V' && event.altKey && event.key.toLowerCase() === 'v') {
            event.preventDefault();
            voiceHookMock.start();
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
      }, [options.enabled, options.shortcut]);
      return {
        state: voiceHookMock.state,
        start: voiceHookMock.start,
        stop: voiceHookMock.stop,
        error: null,
        permissionState: voiceHookMock.permissionState,
      };
    }),
  };
});

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

const defaultVoiceConfig: VoiceDictationConfig = {
  enabled: true,
  inputDeviceId: null,
  shortcut: 'Alt+V',
  pushToTalk: true,
  model: { id: VOICE_DICTATION_MODEL_ID },
};

const readyVoiceModelStatus: VoiceModelStatus = {
  id: VOICE_DICTATION_MODEL_ID,
  status: 'ready',
};

let api: ReturnType<typeof mockElectronAPI>;

beforeEach(() => {
  vi.clearAllMocks();
  appStateMock.current = {
    featureFlags: {
      switchboardRelay: false,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
    },
  };
  voiceHookMock.state = 'idle';
  voiceHookMock.permissionState = 'granted';
  voiceHookMock.latestOptions = null;
  api = installElectronAPI(mockElectronAPI());
  vi.mocked(api.voice.getConfig).mockResolvedValue(defaultVoiceConfig);
  vi.mocked(api.voice.getModelStatus).mockResolvedValue(readyVoiceModelStatus);
  vi.mocked(api.voice.getPermissionState).mockResolvedValue('granted');
});

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
    const stop = screen.getByRole('button', { name: 'Stop streaming (Escape)' });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalled();
  });

  it('Enter while streaming does not stop or send', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<ChatInput {...defaultProps} isStreaming={true} onSend={onSend} onStop={onStop} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Escape while streaming calls onStop', () => {
    const onStop = vi.fn();
    render(<ChatInput {...defaultProps} isStreaming={true} onStop={onStop} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onStop).toHaveBeenCalledOnce();
  });

  describe('voice dictation', () => {
    async function renderWithMic(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
      appStateMock.current = {
        featureFlags: {
          switchboardRelay: false,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: true,
        },
      };
      render(<ChatInput {...defaultProps} {...props} />);
      return await screen.findByRole('button', { name: 'Dictate message' });
    }

    it('hides the mic button when the voice dictation feature flag is off', () => {
      appStateMock.current = {
        featureFlags: {
          switchboardRelay: false,
          byoLlm: false,
          chamberCopilot: false,
          voiceDictation: false,
        },
      };

      render(<ChatInput {...defaultProps} />);

      expect(screen.queryByRole('button', { name: 'Dictate message' })).toBeNull();
    });

    it('shows an enabled mic button when the flag is on, permission is granted, and the model is ready', async () => {
      const mic = await renderWithMic();

      expect((mic as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText('Listening…')).toBeNull();
      fireEvent.click(mic);
      expect(voiceHookMock.start).toHaveBeenCalledOnce();
    });

    it('shows a listening indicator while voice dictation is active', async () => {
      voiceHookMock.state = 'listening';

      await renderWithMic();

      expect(screen.getByText('Listening…')).toBeTruthy();
    });

    it('inserts final transcript text at the caret without submitting', async () => {
      await renderWithMic();
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(0, 0);

      act(() => {
        voiceHookMock.latestOptions?.onFinalTranscript('hello');
      });

      await waitFor(() => {
        expect(textarea.value).toBe('hello ');
      });
      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });

    it('preserves an existing draft when appending a transcript', async () => {
      await renderWithMic();
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Draft: ' } });
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      act(() => {
        voiceHookMock.latestOptions?.onFinalTranscript('dictated');
      });

      await waitFor(() => {
        expect(textarea.value).toBe('Draft: dictated ');
      });
    });

    it('Enter submits the edited textarea after dictation inserts text', async () => {
      const onSend = vi.fn();
      await renderWithMic({ onSend });
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      textarea.focus();

      act(() => {
        voiceHookMock.latestOptions?.onFinalTranscript('send this');
      });
      await waitFor(() => {
        expect(textarea.value).toBe('send this ');
      });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSend).toHaveBeenCalledWith('send this ', undefined);
    });

    it('disables the mic and exposes the settings tooltip when the dictation model is not downloaded', async () => {
      vi.mocked(api.voice.getModelStatus).mockResolvedValue({
        id: VOICE_DICTATION_MODEL_ID,
        status: 'not-downloaded',
      });

      const mic = await renderWithMic();

      expect((mic as HTMLButtonElement).disabled).toBe(true);
      expect(mic.getAttribute('title')).toBe('Download the dictation model in Settings → Voice dictation');
    });

    it('does not start push-to-talk while the shortcode popover is open', async () => {
      await renderWithMic();
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'selectionStart', { configurable: true, value: 3 });
      Object.defineProperty(textarea, 'selectionEnd', { configurable: true, value: 3 });
      fireEvent.change(textarea, { target: { value: ':sm' } });
      await waitFor(() => screen.getByTestId('shortcode-popover'));
      await waitFor(() => {
        expect(voiceHookMock.latestOptions?.enabled).toBe(false);
      });

      fireEvent.keyDown(document, { key: 'v', altKey: true });

      expect(voiceHookMock.start).not.toHaveBeenCalled();
    });

    it('does not start push-to-talk during IME composition', async () => {
      await renderWithMic();
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.compositionStart(textarea);
      await waitFor(() => {
        expect(voiceHookMock.latestOptions?.enabled).toBe(false);
      });

      fireEvent.keyDown(document, { key: 'v', altKey: true });

      expect(voiceHookMock.start).not.toHaveBeenCalled();
    });
  });

  it('shows Loading models when no models available and not disabled', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByText('Loading models…')).toBeTruthy();
  });

  it('disables the model selector when the input is disabled', () => {
    render(<ChatInput
      {...defaultProps}
      disabled={true}
      availableModels={[{ id: 'model-1', name: 'Model 1' }]}
      selectedModel="model-1"
    />);

    expect(screen.getByRole('combobox').hasAttribute('data-disabled')).toBe(true);
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

describe('ChatInput controlled value (per-agent compose drafts #221)', () => {
  it('renders the controlled value and forwards edits via onValueChange', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ChatInput {...defaultProps} value="A draft" onValueChange={onValueChange} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('A draft');

    fireEvent.change(textarea, { target: { value: 'A draft typed more' } });
    expect(onValueChange).toHaveBeenCalledWith('A draft typed more');

    // Parent reflects the new value -> textarea updates (controlled semantics).
    rerender(
      <ChatInput {...defaultProps} value="A draft typed more" onValueChange={onValueChange} />,
    );
    expect(textarea.value).toBe('A draft typed more');
  });

  it('switching the controlled value swaps the textarea content (mind switch UX)', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ChatInput {...defaultProps} value="draft for A" onValueChange={onValueChange} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('draft for A');

    rerender(
      <ChatInput {...defaultProps} value="draft for B" onValueChange={onValueChange} />,
    );
    expect(textarea.value).toBe('draft for B');
  });

  it('pasting an image after switching controlled drafts updates the current mind draft setter', async () => {
    const onMindAValueChange = vi.fn();
    const onMindBValueChange = vi.fn();
    const { rerender } = render(
      <ChatInput {...defaultProps} value="" onValueChange={onMindAValueChange} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    rerender(
      <ChatInput {...defaultProps} value="" onValueChange={onMindBValueChange} />,
    );
    const file = new File(['image-bytes'], 'paste.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        }],
      },
    });

    await waitFor(() => {
      expect(onMindBValueChange).toHaveBeenCalledWith('[📷 image-1.png]');
    });
    expect(onMindAValueChange).not.toHaveBeenCalled();
  });

  it('clearing the controlled value to "" empties the textarea (post-send clear)', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <ChatInput {...defaultProps} value="ready to send" onValueChange={onValueChange} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    rerender(
      <ChatInput {...defaultProps} value="" onValueChange={onValueChange} />,
    );
    expect(textarea.value).toBe('');
  });

  it('keeps prior uncontrolled behavior when value is omitted', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'local-only' } });
    expect(textarea.value).toBe('local-only');
  });
});
