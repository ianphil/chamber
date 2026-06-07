// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { VoiceModeController } from './VoiceModeController';
import type { VoiceRecognizer, VoiceRecognizerCallbacks, VoiceRecognizerFactory } from '../../hooks/useVoiceInput';
import type { VoiceSynthesizer, VoiceSynthesizerCallbacks, VoiceSynthesizerFactory } from '../../hooks/useVoiceConversation';
import type { AzureSpeechToken } from '@chamber/shared/types';

function makeFakeRecognizer() {
  const start = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const dispose = vi.fn<() => void>();
  const recognizer: VoiceRecognizer = { start, stop, dispose };
  let captured: VoiceRecognizerCallbacks | undefined;
  const factory: VoiceRecognizerFactory = (_t, _r, _l, cb) => {
    captured = cb;
    return recognizer;
  };
  return { start, stop, dispose, recognizer, factory, get callbacks() { return captured!; } };
}

function makeFakeSynthesizer() {
  const spoken: string[] = [];
  const speak = vi.fn<(text: string) => Promise<void>>((text) => {
    spoken.push(text);
    return Promise.resolve();
  });
  const stop = vi.fn<() => void>();
  const dispose = vi.fn<() => void>();
  const synthesizer: VoiceSynthesizer = { speak, stop, dispose };
  let captured: VoiceSynthesizerCallbacks | undefined;
  const factory: VoiceSynthesizerFactory = (_t, _r, _v, cb) => {
    captured = cb;
    return synthesizer;
  };
  return { speak, stop, dispose, synthesizer, factory, spoken, get callbacks() { return captured!; } };
}

const token: AzureSpeechToken = { token: 'tok', region: 'eastus', expiresAt: Date.now() + 600_000 };

function setup(overrides: { onUtterance?: (t: string) => void; onClose?: () => void } = {}) {
  const recognizer = makeFakeRecognizer();
  const synthesizer = makeFakeSynthesizer();
  const onUtterance = overrides.onUtterance ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const mintToken = vi.fn<() => Promise<AzureSpeechToken | null>>(() => Promise.resolve(token));
  const view = render(
    <VoiceModeController
      onUtterance={onUtterance}
      reply={null}
      onClose={onClose}
      mintToken={mintToken}
      createRecognizer={recognizer.factory}
      createSynthesizer={synthesizer.factory}
    />,
  );
  return { recognizer, synthesizer, onUtterance, onClose, mintToken, view };
}

describe('VoiceModeController', () => {
  it('starts a session and shows the listening status', async () => {
    setup();
    expect(await screen.findByText('Listening')).toBeTruthy();
  });

  it('forwards a finalized utterance and switches to thinking', async () => {
    const onUtterance = vi.fn();
    const { recognizer } = setup({ onUtterance });
    await screen.findByText('Listening');
    act(() => recognizer.callbacks.onFinal('what is the weather'));
    expect(onUtterance).toHaveBeenCalledWith('what is the weather');
    expect(await screen.findByText('Thinking')).toBeTruthy();
  });

  it('speaks a reply that streams in while the session is active', async () => {
    const { recognizer, synthesizer, view } = setup();
    await screen.findByText('Listening');
    act(() => recognizer.callbacks.onFinal('hello'));

    await act(async () => {
      view.rerender(
        <VoiceModeController
          onUtterance={vi.fn()}
          reply={{ id: 'r1', text: 'Hi there. ', streaming: true }}
          onClose={vi.fn()}
          mintToken={vi.fn(() => Promise.resolve(token))}
          createRecognizer={recognizer.factory}
          createSynthesizer={synthesizer.factory}
        />,
      );
    });

    await waitFor(() => expect(synthesizer.spoken).toContain('Hi there.'));
  });

  it('does not replay a reply that completed before the session opened', async () => {
    const recognizer = makeFakeRecognizer();
    const synthesizer = makeFakeSynthesizer();
    render(
      <VoiceModeController
        onUtterance={vi.fn()}
        reply={{ id: 'old', text: 'old reply.', streaming: false }}
        onClose={vi.fn()}
        mintToken={vi.fn(() => Promise.resolve(token))}
        createRecognizer={recognizer.factory}
        createSynthesizer={synthesizer.factory}
      />,
    );
    await screen.findByText('Listening');
    expect(synthesizer.spoken).toHaveLength(0);
  });

  it('invokes onClose from the overlay', async () => {
    const onClose = vi.fn();
    setup({ onClose });
    await screen.findByText('Listening');
    fireEvent.click(screen.getByLabelText('Close voice mode'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
