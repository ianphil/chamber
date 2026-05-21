// ChatService — thin message streaming layer.
// Gets sessions from MindManager, streams SDK events via callback.

import type { MindManager } from '../mind';
import type { ChatEvent, ChatImageAttachment, ConversationResumeResult, ConversationSummary, ModelInfo } from '@chamber/shared/types';
import { modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
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
import { TurnLifecycleTrace } from './turnLifecycleTrace';

const log = Logger.create('ChatService');

// INVARIANT: this is a post-root-turn_end debounce, not a turn deadline.
// It is never armed unless the SDK has already signalled the root turn ended.
const TURN_END_QUIESCENCE_MS = 1_000;

export class ChatService {
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly mindManager: MindManager,
    private readonly turnQueue: TurnQueue,
    private readonly dateTimeContextProvider: DateTimeContextProvider = getCurrentDateTimeContext,
    /**
     * Optional provider injected by main.ts that returns BYO LLM models when
     * BYO is enabled. Returning null/undefined falls back to the bundled SDK's
     * `client.listModels()`. This is required because the SDK's listModels API
     * always queries GitHub's official Copilot model catalog and does NOT honor
     * the COPILOT_PROVIDER_BASE_URL env var even when BYOK mode is active for
     * inference.
     */
    private readonly byoLlmModelsProvider?: () => Promise<ModelInfo[] | null>,
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
          await this.streamTurn(currentSession, prompt, abortController, emit, attachments, () => {
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
          await this.streamTurn(recoveredSession, prompt, abortController, emit, attachments, () => {
            this.mindManager.markActiveConversationHasMessages(mindId, prompt);
          });
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        const rawMessage = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message: mapByoLlmError(rawMessage) });
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
    onSendAccepted?: () => void,
  ): Promise<void>{
    if (abortController.signal.aborted) return;

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

    // Per-turn lifecycle trace (issue #299). The single-arg `session.on(handler)`
    // overload receives every SDK event for this turn; the trace records
    // metadata-only entries (no payload contents) so we can distinguish missing
    // `session.idle` from a Chamber typed-listener miss after the fact.
    //
    // Defensive completion path (#297): if the SDK emits root
    // `assistant.turn_end` but never follows with `session.idle`, complete
    // only after a post-turn quiescence window with no tools or sub-agent
    // turns still active. This is intentionally NOT a wall-clock turn
    // deadline: no root turn_end means no timer is armed.
    const trace = new TurnLifecycleTrace();
    // Default to 'threw' so that any pathway which escapes via an exception
    // before the idle / error / abort handlers fire (e.g. `session.send`
    // rejecting with a non-stale network error, attachment marshalling
    // throwing, etc.) is logged honestly. Only the success path flips this
    // to 'completed'. Without this default, the summary would lie about
    // turns that failed before reaching `await turnDone` — defeating the
    // forensic purpose of the trace.
    let terminalReason:
      | 'completed'
      | 'turn_end_quiescence'
      | 'aborted'
      | 'sdk_error'
      | 'sdk_contract'
      | 'threw' = 'threw';
    const logTraceSummary = () => {
      const summary = trace.summary(terminalReason);
      // Fingerprint of the #299 stuck-streaming bug: the SDK signalled the
      // root agent's turn ended but never emitted `session.idle`, so the turn
      // hung until the user pressed Stop. Use `sawRootTurnEnd` (not
      // `sawTurnEnd`) so sub-agent turn_end events — common in chatroom /
      // delegated work and NOT terminal for the root turn — do not trip the
      // info-level log on every aborted multi-agent turn.
      if (terminalReason === 'aborted' && summary.sawRootTurnEnd && !summary.sawIdle) {
        log.info('chat.turn.lifecycle', summary);
      } else {
        log.debug('chat.turn.lifecycle', summary);
      }
    };
    const outstandingToolIds = new Set<string>();
    const pendingPermissionIds = new Set<string>();
    const activeSubAgentIds = new Set<string>();
    let sawRootTurnEnd = false;
    let turnEndQuiescenceTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveTurnEndQuiescence: (() => void) | undefined;
    const clearTurnEndQuiescence = () => {
      if (turnEndQuiescenceTimer) {
        clearTimeout(turnEndQuiescenceTimer);
        turnEndQuiescenceTimer = undefined;
      }
    };
    const maybeArmTurnEndQuiescence = () => {
      if (
        abortController.signal.aborted ||
        !sawRootTurnEnd ||
        outstandingToolIds.size > 0 ||
        pendingPermissionIds.size > 0 ||
        activeSubAgentIds.size > 0
      ) {
        return;
      }
      clearTurnEndQuiescence();
      turnEndQuiescenceTimer = setTimeout(() => {
        turnEndQuiescenceTimer = undefined;
        terminalReason = 'turn_end_quiescence';
        resolveTurnEndQuiescence?.();
      }, TURN_END_QUIESCENCE_MS);
    };
    const trackTerminalCandidate = (event: Parameters<TurnLifecycleTrace['record']>[0]) => {
      clearTurnEndQuiescence();

      if (event.type === 'tool.execution_start' && typeof event.data?.toolCallId === 'string') {
        outstandingToolIds.add(event.data.toolCallId);
      }
      if (event.type === 'tool.execution_complete' && typeof event.data?.toolCallId === 'string') {
        outstandingToolIds.delete(event.data.toolCallId);
      }
      if (event.type === 'permission.requested' && typeof event.data?.requestId === 'string') {
        pendingPermissionIds.add(event.data.requestId);
      }
      if (event.type === 'permission.completed' && typeof event.data?.requestId === 'string') {
        pendingPermissionIds.delete(event.data.requestId);
      }
      if (event.type === 'assistant.turn_start') {
        if (typeof event.agentId === 'string') {
          activeSubAgentIds.add(event.agentId);
        } else {
          sawRootTurnEnd = false;
        }
      }
      if (event.type === 'assistant.turn_end') {
        if (typeof event.agentId === 'string') {
          activeSubAgentIds.delete(event.agentId);
        } else {
          sawRootTurnEnd = true;
        }
      }

      maybeArmTurnEndQuiescence();
    };
    try {
      const unsubTrace = session.on((event) => {
        const sdkEvent = event as Parameters<TurnLifecycleTrace['record']>[0];
        trace.record(sdkEvent);
        trackTerminalCandidate(sdkEvent);
      });
      unsubs.push(unsubTrace);

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
          clearTurnEndQuiescence();
          terminalReason = 'completed';
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (event) => {
          unsubError();
          clearTurnEndQuiescence();
          try {
            terminalReason = 'sdk_error';
            reject(new Error(getSdkSessionErrorMessage(event)));
          } catch (error) {
            // failSdkContract aborts; the abort listener below will then
            // observe `sdkContractFailed` and reclassify terminalReason to
            // 'sdk_contract'. Keep that reclassification logic in mind if
            // you change the abort dispatch model (today AbortSignal fires
            // synchronously, which preserves last-write-wins ordering).
            failSdkContract(error);
            resolve();
          }
        });
        unsubs.push(unsubError);

        abortController.signal.addEventListener('abort', () => {
          clearTurnEndQuiescence();
          // failSdkContract aborts after setting sdkContractFailed; preserve
          // that classification rather than overwriting with 'aborted'.
          terminalReason = sdkContractFailed ? 'sdk_contract' : 'aborted';
          resolve();
        }, { once: true });
        resolveTurnEndQuiescence = resolve;
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

      if (abortController.signal.aborted) return;
      emit({ type: 'done' });
    } finally {
      clearTurnEndQuiescence();
      for (const unsub of unsubs) unsub();
      logTraceSummary();
    }
  }

  async cancelMessage(mindId: string, _messageId: string): Promise<boolean> {
    void _messageId;
    const controller = this.abortControllers.get(mindId);
    if (!controller) return false;
    controller.abort();
    this.abortControllers.delete(mindId);
    const context = this.mindManager.getMind(mindId);
    if (context?.session) {
      await context.session.abort().catch(() => { /* noop */ });
    }
    return true;
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
    let sdkModels: ModelInfo[] = [];
    let sdkError: unknown = null;
    if (context?.client) {
      // Defensive: clear any SDK-level cache. As of @github/copilot-sdk@0.3.0
      // this is a no-op (see modelCacheCompat). The cache that actually
      // controls model freshness lives in the CLI server process with a
      // 30-min TTL — only a CLI subprocess restart can bust it.
      // See docs/model-cache-investigation.md (issue #90).
      clearCopilotModelsCache(context.client);
      try {
        const raw = await context.client.listModels();
        sdkModels = mapSdkModelList(raw);
      } catch (err) {
        sdkError = err;
      }
    }

    let byoModels: ModelInfo[] = [];
    if (this.byoLlmModelsProvider) {
      try {
        byoModels = (await this.byoLlmModelsProvider()) ?? [];
      } catch (err) {
        log.error('byoLlmModelsProvider failed (skipping BYO models):', err);
      }
    }

    // If SDK errored AND we have no BYO fallback, propagate (preserves existing
    // behavior so tests/UI can surface the SDK failure). If BYO is providing
    // models, suppress the SDK error and return BYO-only — the user explicitly
    // chose a custom endpoint and shouldn't be blocked by Copilot SDK issues.
    if (sdkError && byoModels.length === 0) {
      throw sdkError;
    }

    if (byoModels.length === 0) return sdkModels;

    // Merge: append BYO models after SDK models. Keep same-id cloud/BYO entries
    // distinct by provider-aware key so the renderer can route them differently.
    const seen = new Set(sdkModels.map((m) => modelSelectionKeyFromModel(m)));
    const merged = [...sdkModels];
    for (const m of byoModels) {
      const key = modelSelectionKeyFromModel(m);
      if (!seen.has(key)) {
        merged.push(m);
        seen.add(key);
      }
    }
    log.debug(`listModels: ${sdkModels.length} SDK + ${byoModels.length} BYO -> ${merged.length} merged`);
    return merged;
  }

  private assertCanSwitchConversation(mindId: string): void {
    if (this.abortControllers.has(mindId)) {
      throw new Error('Cannot switch conversations while a message is still streaming.');
    }
  }
}


/**
 * Friendly mapper for upstream LLM errors that originate from BYO LLM endpoints.
 * Detects llama.cpp / LM Studio context-too-small responses and rewrites them
 * into actionable guidance.
 */
export function mapByoLlmError(rawMessage: string): string {
  if (/n_keep:\s*\d+\s*>=\s*n_ctx:\s*\d+/.test(rawMessage)) {
    return `The local model's context window is too small for Chamber's system prompt. Either pick a larger-context model (e.g. qwen3.5-9b for 32K, gemma-4-26b for 128K) or increase the context length when loading the model in LM Studio. Original error: ${rawMessage}`;
  }
  if (/context.*(?:length|window)/i.test(rawMessage) && /(too|exceed|maximum)/i.test(rawMessage)) {
    return `Model context window exceeded. Try a larger model or reduce the conversation history. Original: ${rawMessage}`;
  }
  return rawMessage;
}
