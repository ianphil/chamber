// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import type { MindManager } from '../mind';
import type { ChatEvent, ModelInfo } from '../../../shared/types';
import type { CopilotSession } from '../mind/types';
import { isStaleSessionError, SEND_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS, sendTimeoutError } from '../../../shared/sessionErrors';
import { TurnQueue } from './TurnQueue';

export class ChatService {
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly mindManager: MindManager,
    private readonly turnQueue: TurnQueue,
  ) {}

  async sendMessage(
    mindId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    _model?: string,
  ): Promise<void> {
    void _model;
    return this.turnQueue.enqueue(mindId, async () => {
      const abortController = new AbortController();
      this.abortControllers.set(mindId, abortController);

      try {
        const context = this.mindManager.getMind(mindId);
        if (!context?.session) {
          throw new Error(`Mind ${mindId} not found or has no session`);
        }

        try {
          await this.streamTurn(context.session, prompt, abortController, emit);
        } catch (err) {
          if (abortController.signal.aborted) return;
          if (!isStaleSessionError(err)) throw err;

          // Stale session — recreate and retry once
          emit({ type: 'reconnecting' });
          const freshSession = await this.mindManager.recreateSession(mindId);
          await this.streamTurn(freshSession, prompt, abortController, emit);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message });
      } finally {
        this.abortControllers.delete(mindId);
      }
    });
  }

  private async streamTurn(
    session: CopilotSession,
    prompt: string,
    abortController: AbortController,
    emit: (event: ChatEvent) => void,
  ): Promise<void> {
    const unsubs: (() => void)[] = [];
    const guard = (fn: () => void) => { if (!abortController.signal.aborted) fn(); };

    try {
      // Text streaming
      unsubs.push(session.on('assistant.message_delta', (event) => {
        guard(() => emit({
          type: 'chunk',
          sdkMessageId: event.data.messageId,
          content: event.data.deltaContent,
        }));
      }));

      // Final assistant message
      unsubs.push(session.on('assistant.message', (event) => {
        guard(() => {
          if (event.data.content) {
            emit({
              type: 'message_final',
              sdkMessageId: event.data.messageId,
              content: event.data.content,
            });
          }
        });
      }));

      // Reasoning
      unsubs.push(session.on('assistant.reasoning_delta', (event) => {
        guard(() => emit({
          type: 'reasoning',
          reasoningId: event.data.reasoningId,
          content: event.data.deltaContent,
        }));
      }));

      // Tool execution
      unsubs.push(session.on('tool.execution_start', (event) => {
        guard(() => emit({
          type: 'tool_start',
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          args: event.data.arguments as Record<string, unknown> | undefined,
          parentToolCallId: event.data.parentToolCallId,
        }));
      }));

      unsubs.push(session.on('tool.execution_progress', (event) => {
        guard(() => emit({
          type: 'tool_progress',
          toolCallId: event.data.toolCallId,
          message: event.data.progressMessage,
        }));
      }));

      unsubs.push(session.on('tool.execution_partial_result', (event) => {
        guard(() => emit({
          type: 'tool_output',
          toolCallId: event.data.toolCallId,
          output: event.data.partialOutput,
        }));
      }));

      unsubs.push(session.on('tool.execution_complete', (event) => {
        guard(() => emit({
          type: 'tool_done',
          toolCallId: event.data.toolCallId,
          success: event.data.success,
          result: event.data.result?.content,
          error: event.data.error?.message,
        }));
      }));

      // Set up idle/error listeners BEFORE send to avoid missing events
      // that fire synchronously inside session.send (regression-test guarded).
      let turnDoneTimerId: ReturnType<typeof setTimeout> | undefined;
      const turnDone = new Promise<void>((resolve, reject) => {
        turnDoneTimerId = setTimeout(resolve, DEFAULT_TURN_TIMEOUT_MS);

        const unsubIdle = session.on('session.idle', () => {
          if (turnDoneTimerId) clearTimeout(turnDoneTimerId);
          unsubIdle();
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event) => {
          if (turnDoneTimerId) clearTimeout(turnDoneTimerId);
          unsubError();
          reject(new Error(event.data.message));
        });
        unsubs.push(unsubError);

        abortController.signal.addEventListener('abort', () => {
          if (turnDoneTimerId) clearTimeout(turnDoneTimerId);
          resolve();
        }, { once: true });
      });

      // Send with a timeout guard — if session.send() itself hangs (dead
      // WebSocket, killed CLI), surface as a stale-session error so the
      // outer catch can recreate the session and retry.
      let sendTimerId: ReturnType<typeof setTimeout> | undefined;
      const sendTimeout = new Promise<never>((_, reject) => {
        sendTimerId = setTimeout(() => reject(sendTimeoutError()), SEND_TIMEOUT_MS);
      });
      try {
        await Promise.race([session.send({ prompt }), sendTimeout]);
      } finally {
        if (sendTimerId) clearTimeout(sendTimerId);
      }

      // Wait for idle (listeners already active from before send)
      await turnDone;

      if (abortController.signal.aborted) return;
      emit({ type: 'done' });
    } finally {
      for (const unsub of unsubs) unsub();
    }
  }

  async cancelMessage(mindId: string, _messageId: string): Promise<void> {
    void _messageId;
    const controller = this.abortControllers.get(mindId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(mindId);
    }
    const context = this.mindManager.getMind(mindId);
    if (context?.session) {
      await context.session.abort().catch(() => { /* noop */ });
    }
  }

  async newConversation(mindId: string): Promise<void> {
    await this.mindManager.recreateSession(mindId);
  }

  async listModels(mindId: string): Promise<ModelInfo[]> {
    try {
      const context = this.mindManager.getMind(mindId);
      if (!context?.client) return [];
      // The SDK caches models forever per CopilotClient instance.
      // Clear the cache so we always get a fresh list from the CLI.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (context.client as any).modelsCache = null;
      const models = await context.client.listModels();
      return models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  }
}
