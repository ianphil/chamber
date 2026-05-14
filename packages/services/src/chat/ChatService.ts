// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import { randomUUID } from 'node:crypto';
import type { MindManager } from '../mind';
import type { ChatEvent, ChatImageAttachment, ConversationResumeResult, ConversationSummary, ModelInfo } from '@chamber/shared/types';
import type { CompletedTurn, TurnCompletionObserver } from '@chamber/shared/turn-observer';
import type { CopilotSession } from '../mind/types';
import { isStaleSessionError, SEND_TIMEOUT_MS, sendTimeoutError } from '@chamber/shared/sessionErrors';
import { Logger } from '../logger';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkPermissionCompleted,
  mapSdkPermissionRequested,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionPartialResult,
  mapSdkToolExecutionProgress,
  mapSdkToolExecutionStart,
} from '../sdk/sdkChatEventMapper';
import { clearCopilotModelsCache } from '../sdk/modelCacheCompat';
import { mapSdkModelList } from '../sdk/sdkModelMapper';
import { TurnQueue } from './TurnQueue';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext, type DateTimeContextProvider } from './currentDateTimeContext';

const log = Logger.create('ChatService');

export class ChatService {
  private abortControllers = new Map<string, AbortController>();
  private readonly observers: TurnCompletionObserver[];

  constructor(
    private readonly mindManager: MindManager,
    private readonly turnQueue: TurnQueue,
    private readonly dateTimeContextProvider: DateTimeContextProvider = getCurrentDateTimeContext,
    initialObservers: readonly TurnCompletionObserver[] = [],
  ) {
    // Defensive copy — callers may mutate the array they passed in.
    this.observers = [...initialObservers];
  }

  /**
   * Register a turn-completion observer (Phase 11 wiring — used by
   * MindMemoryService to attach the per-mind DailyLogWriter when a mind is
   * activated). Adding an observer mid-flight is safe because
   * `notifyTurnCompleted` reads the array at notify time.
   */
  addObserver(observer: TurnCompletionObserver): void {
    this.observers.push(observer);
  }

  /**
   * Remove a previously-registered observer (no-op if not present). Used
   * by MindMemoryService.releaseMind so a swapped-out mind stops receiving
   * turn frames.
   */
  removeObserver(observer: TurnCompletionObserver): void {
    const i = this.observers.indexOf(observer);
    if (i !== -1) this.observers.splice(i, 1);
  }

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

      const startedAt = new Date().toISOString();
      const turnId = randomUUID();

      try {
        const context = this.mindManager.getMind(mindId);
        if (!context?.session) {
          throw new Error(`Mind ${mindId} not found or has no session`);
        }

        let finalAssistantMessage: string | null = null;
        try {
          const session = model ? await this.mindManager.setMindModel(mindId, model) : null;
          const currentSession = session ? this.mindManager.getMind(mindId)?.session : context.session;
          if (!currentSession) throw new Error(`Mind ${mindId} not found or has no session`);
          finalAssistantMessage = await this.streamTurn(currentSession, prompt, abortController, emit, attachments, () => {
            this.mindManager.markActiveConversationHasMessages(mindId, prompt);
          });
        } catch (err) {
          if (abortController.signal.aborted) return;
          if (!isStaleSessionError(err)) throw err;

          // SDK forgot the session — recover once by reattaching, then retry.
          // If reattach also fails stale, surface the error so the user can start a new chat.
          emit({ type: 'reconnecting' });
          const recoveredSession = await this.mindManager.recoverActiveConversationSession(mindId);
          if (abortController.signal.aborted) return;
          finalAssistantMessage = await this.streamTurn(recoveredSession, prompt, abortController, emit, attachments, () => {
            this.mindManager.markActiveConversationHasMessages(mindId, prompt);
          });
        }

        // Notify TurnCompletionObservers ONLY on successful completion. The
        // streamTurn helper returns null whenever the turn was aborted by
        // the user or torn down by an SDK contract failure; both branches
        // skip notification. Errors thrown out of streamTurn fall through
        // to the outer catch below, which also bypasses notification.
        if (finalAssistantMessage !== null && !abortController.signal.aborted) {
          const endedAt = new Date().toISOString();
          const refreshed = this.mindManager.getMind(mindId);
          // Coerce empty model to a sentinel so the structured-log frame is
          // semantically meaningful. The parser accepts empty values, but
          // 'unknown' is more useful in rendered rollback markdown than a
          // bare `(`.
          const turnModel = model ?? refreshed?.selectedModel ?? '';
          this.notifyTurnCompleted({
            turnId,
            sessionId: refreshed?.activeSessionId ?? '',
            model: turnModel.length > 0 ? turnModel : 'unknown',
            status: 'completed',
            startedAt,
            endedAt,
            prompt,
            finalAssistantMessage,
          });
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

  /**
   * Notify each observer of a completed turn. One observer throwing (sync
   * or async) must NOT block subsequent observers and must NOT propagate
   * back into the streaming path. Failures are logged at warn level with
   * the offending observer's index for triage.
   */
  private notifyTurnCompleted(turn: CompletedTurn): void {
    for (let i = 0; i < this.observers.length; i++) {
      const observer = this.observers[i];
      try {
        const result = observer.onTurnCompleted(turn);
        if (result && typeof (result as Promise<void>).then === 'function') {
          Promise.resolve(result).catch((err: unknown) => {
            log.warn(`TurnCompletionObserver[${i}] failed asynchronously`, err);
          });
        }
      } catch (err) {
        log.warn(`TurnCompletionObserver[${i}] failed`, err);
      }
    }
  }

  private async streamTurn(
    session: CopilotSession,
    prompt: string,
    abortController: AbortController,
    emit: (event: ChatEvent) => void,
    attachments?: ChatImageAttachment[],
    onSendAccepted?: () => void,
  ): Promise<string | null>{
    if (abortController.signal.aborted) return null;

    const unsubs: (() => void)[] = [];
    let finalAssistantMessage = '';
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

      // Final assistant message — also captured for TurnCompletionObservers
      // so the observer payload carries the same text the renderer sees.
      // The SDK can fire `assistant.message` more than once per turn (e.g.
      // around tool use); keep the most recent non-null content.
      unsubs.push(session.on('assistant.message', (event) => {
        emitMapped(() => {
          const mapped = mapSdkAssistantMessage(event);
          if (mapped) finalAssistantMessage = mapped.content;
          return mapped;
        });
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

      // Permission events (issue #131 checklist 5). The SDK emits
      // `permission.requested` when a tool/url/etc. asks for approval and
      // `permission.completed` once the handler returns. We surface both
      // as chat events so the UI can render an inline permission entry
      // that updates from "pending" to its final outcome (approved /
      // denied-*). Approval logic itself still lives in the
      // onPermissionRequest handler wired by MindManager.
      unsubs.push(session.on('permission.requested', (event) => {
        emitMapped(() => mapSdkPermissionRequested(event));
      }));

      unsubs.push(session.on('permission.completed', (event) => {
        emitMapped(() => mapSdkPermissionCompleted(event));
      }));

      // Set up idle/error listeners BEFORE send to avoid missing events
      // that fire synchronously inside session.send (regression-test guarded).
      //
      // INVARIANT: no fallback wall-clock deadline on the turn (#222).
      // Long-running agent work - deep research, multi-step tool chains,
      // big-codebase analysis - is a first-class Chamber use case. The
      // user owns "this has gone on long enough" via the Stop button,
      // which calls cancelMessage -> abortController.abort() -> session.abort().
      // We rely on the SDK to eventually emit `session.idle`, `session.error`,
      // or for the user to cancel. SEND_TIMEOUT_MS below still bounds the
      // separate failure mode of `session.send()` itself wedging.
      const turnDone = new Promise<void>((resolve, reject) => {
        const unsubIdle = session.on('session.idle', () => {
          unsubIdle();
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event) => {
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
          resolve();
        }, { once: true });
      });
      // Defensive no-op catch: if `session.send` throws and we never reach
      // `await turnDone` below, this guarantees a later SDK error rejection is
      // observed instead of surfacing as an unhandled rejection.
      turnDone.catch(() => { /* observed in await below or intentionally discarded */ });

      // Send with a timeout guard: if session.send() itself hangs (dead
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
        guard(() => onSendAccepted?.());
      } finally {
        if (sendTimerId) clearTimeout(sendTimerId);
      }

      // Wait for idle (listeners already active from before send).
      await turnDone;

      if (abortController.signal.aborted) return null;
      emit({ type: 'done' });
      return finalAssistantMessage;
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

  async setMindModel(mindId: string, model: string | null): Promise<Awaited<ReturnType<MindManager['setMindModel']>>> {
    return this.turnQueue.enqueue(mindId, () => this.mindManager.setMindModel(mindId, model));
  }

  async newConversation(mindId: string): Promise<ConversationResumeResult> {
    this.assertCanSwitchConversation(mindId);
    await this.mindManager.startNewConversation(mindId);
    return {
      sessionId: this.mindManager.getMind(mindId)?.activeSessionId ?? '',
      messages: [],
      conversations: this.mindManager.listConversationHistory(mindId),
    };
  }

  listConversationHistory(mindId: string): ConversationSummary[] {
    return this.mindManager.listConversationHistory(mindId);
  }

  async resumeConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    this.assertCanSwitchConversation(mindId);
    return this.mindManager.resumeConversation(mindId, sessionId);
  }

  async deleteConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    this.assertCanSwitchConversation(mindId);
    return this.mindManager.deleteConversation(mindId, sessionId);
  }

  renameConversation(mindId: string, sessionId: string, title: string): ConversationSummary[] {
    return this.mindManager.renameConversation(mindId, sessionId, title);
  }

  async listModels(mindId: string): Promise<ModelInfo[]> {
    const context = this.mindManager.getMind(mindId);
    if (!context?.client) return [];
    // Defensive: clear any SDK-level cache. As of @github/copilot-sdk@0.3.0
    // this is a no-op (see modelCacheCompat). The cache that actually
    // controls model freshness lives in the CLI server process with a
    // 30-min TTL — only a CLI subprocess restart can bust it.
    // See docs/model-cache-investigation.md (issue #90).
    clearCopilotModelsCache(context.client);
    const models = await context.client.listModels();
    return mapSdkModelList(models);
  }

  async refreshModels(mindId: string): Promise<ModelInfo[]> {
    // The CLI server process holds a 30-min in-memory model cache that
    // cannot be busted in-place — see docs/model-cache-investigation.md
    // (issue #90). The only way to force a fresh `/models` fetch is to
    // restart the CLI subprocess, so we recycle the SDK client + active
    // session in place via MindManager.recycleClientForMind. This keeps
    // chatroom orchestration intact (no mind:unloaded teardown).
    //
    // Refusing mid-stream serves two purposes: (1) we don't yank the rug
    // out from under an executing turn, and (2) routing the recycle call
    // through TurnQueue.enqueue serializes it against any send that has
    // already been enqueued but not yet pulled off the chain — so the
    // assertion below is fast-fail UX, and the queue is the real lock.
    this.assertCanRefreshModels(mindId);
    return this.turnQueue.enqueue(mindId, async () => {
      // Re-check inside the queue: a different actor could have parked an
      // AbortController between our assertion and the queue acquiring the
      // lock. With TurnQueue serializing all sends and refreshes for this
      // mind, this branch is defensive but cheap.
      this.assertCanRefreshModels(mindId);
      await this.mindManager.recycleClientForMind(mindId);
      return this.listModels(mindId);
    });
  }

  private assertCanRefreshModels(mindId: string): void {
    if (this.abortControllers.has(mindId)) {
      throw new Error('Cannot refresh models while a message is still streaming.');
    }
  }

  private assertCanSwitchConversation(mindId: string): void {
    if (this.abortControllers.has(mindId)) {
      throw new Error('Cannot switch conversations while a message is still streaming.');
    }
  }
}
