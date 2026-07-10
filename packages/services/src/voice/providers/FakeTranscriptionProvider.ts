import type { TranscriptionEvent } from '@chamber/shared/voice-types';
import type { TranscriptionProvider, TranscriptionProviderStartOptions } from './types';

export const FAKE_SENTINEL_TRANSCRIPT = 'hello chamber voice dictation';

export interface FakeTranscriptionProviderOptions {
  readonly chunksUntilFinal?: number;
  readonly clock?: (callback: () => void) => void;
}

export class FakeTranscriptionProvider implements TranscriptionProvider {
  private readonly chunksUntilFinal: number;
  private readonly clock: (callback: () => void) => void;
  private readonly listeners = new Set<(event: TranscriptionEvent) => void>();
  private started = false;
  private appendCount = 0;
  private partialEmitted = false;
  private finalEmitted = false;
  private sessionId: string | null = null;

  constructor(options: FakeTranscriptionProviderOptions = {}) {
    this.chunksUntilFinal = Math.max(1, Math.floor(options.chunksUntilFinal ?? 3));
    this.clock = options.clock ?? ((callback) => queueMicrotask(callback));
  }

  async start(opts: TranscriptionProviderStartOptions): Promise<void> {
    if (this.started) {
      throw new Error('Fake transcription provider is already started');
    }
    this.started = true;
    this.sessionId = opts.sessionId;
    this.appendCount = 0;
    this.partialEmitted = false;
    this.finalEmitted = false;
    this.emit({ type: 'sessionStarted', sessionId: opts.sessionId });
  }

  async append(pcm: Uint8Array): Promise<void> {
    void pcm;
    if (!this.started) {
      throw new Error('Cannot append audio before starting a transcription session');
    }
    if (this.finalEmitted) return;

    this.appendCount += 1;
    if (!this.partialEmitted && this.appendCount >= Math.max(1, Math.floor(this.chunksUntilFinal / 2))) {
      this.partialEmitted = true;
      this.emit({ type: 'partial', sessionId: this.requireSessionId(), text: 'hello chamber' });
    }
    if (this.appendCount >= this.chunksUntilFinal) {
      this.finalEmitted = true;
      this.emit({ type: 'final', sessionId: this.requireSessionId(), text: FAKE_SENTINEL_TRANSCRIPT, isFinal: true });
    }
  }

  async end(): Promise<void> {
    if (!this.started) return;
    const sessionId = this.requireSessionId();
    this.started = false;
    this.sessionId = null;
    this.emit({ type: 'sessionEnded', sessionId });
  }

  onEvent(cb: (event: TranscriptionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: TranscriptionEvent): void {
    this.clock(() => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error('Fake transcription provider session id is unavailable');
    }
    return this.sessionId;
  }
}
