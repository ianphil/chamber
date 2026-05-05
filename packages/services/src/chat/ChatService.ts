// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import type { MindManager } from '../mind';
import type { ChatEvent, ChatImageAttachment, ModelInfo } from '@chamber/shared/types';
import type { CopilotSession } from '../mind/types';
import { isStaleSessionError, SEND_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS, sendTimeoutError } from '@chamber/shared/sessionErrors';
import { Logger } from '../logger';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionPartialResult,
  mapSdkToolExecutionProgress,
  mapSdkToolExecutionStart,
} from '../sdk/sdkChatEventMapper';
import { clearCopilotModelsCache } from '../sdk/modelCacheCompat';
import { TurnQueue } from './TurnQueue';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext, type DateTimeContextProvider } from './currentDateTimeContext';

const log = Logger.create('ChatService');

export class ChatService {
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly mindManager: MindManager,
    private readonly turnQueue: TurnQueue,
    private readonly dateTimeContextProvider: DateTimeContextProvider = getCurrentDateTimeContext,
  ) {}

  async sendMessage(
    mindId: string,
    prompt: string,
    messageId: string,
    emit: (event: ChatEvent) => void,
    model?: string,
    attachments?: ChatImageAttachment[],
  ): Promise<void> {
    return this.turnQueue.enqueue(mindId, async () => {
      const abortController = new AbortController();
      this.abortControllers.set(mindId, abortController);

      try {
        const context = this.mindManager.getMind(mindId);
        if (!context?.session) {
          throw new Error(`Mind ${mindId} not found or has no session`);
        }

        try {
          const session = model ? await this.mindManager.setMindModel(mindId, model) : null;
          const currentSession = session ? this.mindManager.getMind(mindId)?.session : context.session;
          if (!currentSession) throw new Error(`Mind ${mindId} not found or has no session`);
          await this.streamTurn(currentSession, prompt, abortController, emit, attachments);
        } catch (err) {
          if (abortController.signal.aborted) return;
          if (!isStaleSessionError(err)) throw err;

          // Stale session — recreate and retry once
          emit({ type: 'reconnecting' });
          const freshSession = await this.mindManager.recreateSession(mindId);
          await this.streamTurn(freshSession, prompt, abortController, emit, attachments);
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
    attachments?: ChatImageAttachment[],
  ): Promise<void>{
    const unsubs: (() => void)[] = [];
    const guard = (fn: () => void) => { if (!abortController.signal.aborted) fn(); };
    let sdkContractFailed = false;
    const failSdkContract = (error: unknown) => {
      if (abortController.signal.aborted || sdkContractFailed) return;
      sdkContractFailed = true;
      const message = error instanceof SdkChatEventContractError
        ? error.message
        : 'SDK contract mismatch while streaming chat';
      log.error(message, error);
      emit({ type: 'error', message });
      abortController.abort();
    };
    const emitMapped = (mapper: () => ChatEvent | null) => {
      try {
        const mapped = mapper();
        if (mapped) guard(() => emit(mapped));
      } catch (error) {
        failSdkContract(error);
      }
    };

    try {
      // Text streaming
      unsubs.push(session.on('assistant.message_delta', (event) => {
        emitMapped(() => mapSdkAssistantMessageDelta(event));
      }));

      // Final assistant message
      unsubs.push(session.on('assistant.message', (event) => {
        emitMapped(() => mapSdkAssistantMessage(event));
      }));

      // Reasoning
      unsubs.push(session.on('assistant.reasoning_delta', (event) => {
        emitMapped(() => mapSdkAssistantReasoningDelta(event));
      }));

      // Tool execution
      unsubs.push(session.on('tool.execution_start', (event) => {
        emitMapped(() => mapSdkToolExecutionStart(event));
      }));

      unsubs.push(session.on('tool.execution_progress', (event) => {
        emitMapped(() => mapSdkToolExecutionProgress(event));
      }));

      unsubs.push(session.on('tool.execution_partial_result', (event) => {
        emitMapped(() => mapSdkToolExecutionPartialResult(event));
      }));

      unsubs.push(session.on('tool.execution_complete', (event) => {
        emitMapped(() => mapSdkToolExecutionComplete(event));
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
          try {
            reject(new Error(getSdkSessionErrorMessage(event)));
          } catch (error) {
            failSdkContract(error);
            resolve();
          }
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
        const sdkAttachments = attachments?.map((a) => ({
          type: 'blob' as const,
          data: a.data,
          mimeType: a.mimeType,
          displayName: a.name,
        }));
        const promptWithDateTime = injectCurrentDateTimeContext(prompt, this.dateTimeContextProvider());
        await Promise.race([session.send(sdkAttachments ? { prompt: promptWithDateTime, attachments: sdkAttachments } : { prompt: promptWithDateTime }), sendTimeout]);
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
    const context = this.mindManager.getMind(mindId);
    if (!context?.client) return [];
    // The SDK caches models forever per CopilotClient instance.
    // Clear the cache so we always get a fresh list from the CLI.
    clearCopilotModelsCache(context.client);
    const models = await context.client.listModels();
    return models.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
  }
}
