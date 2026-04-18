import { randomUUID } from 'node:crypto';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, OrchestrationMode, ChatroomMessage } from '../../../../shared/chatroom-types';
import type { OrchestrationContext } from './types';
import type { CopilotSession } from '../../mind';
import { isStaleSessionError } from '../../../../shared/sessionErrors';

// ---------------------------------------------------------------------------
// streamAgentTurn — shared SDK event wiring for all orchestration strategies
// ---------------------------------------------------------------------------

export interface StreamAgentOptions {
  session: CopilotSession;
  mind: MindContext;
  prompt: string;
  roundId: string;
  context: OrchestrationContext;
  abortSignal: AbortSignal;
  unsubs: (() => void)[];
  orchestrationMode: OrchestrationMode;
}

export interface StreamAgentResult {
  /** Raw final content from the assistant (empty string if no content) */
  finalContent: string;
  /** The message ID used for this turn */
  messageId: string;
}

/**
 * Wire all SDK event listeners, send the prompt, and wait for idle.
 * Returns the raw final content — callers handle message creation and persistence.
 */
export async function streamAgentTurn(opts: StreamAgentOptions): Promise<StreamAgentResult> {
  const { session, mind, prompt, roundId, context, abortSignal, unsubs } = opts;
  const messageId = randomUUID();

  const emitEvent = (event: ChatroomStreamEvent['event']) => {
    if (!abortSignal.aborted) {
      context.emitEvent({
        mindId: mind.mindId,
        mindName: mind.identity.name,
        messageId,
        roundId,
        event,
      } satisfies ChatroomStreamEvent);
    }
  };

  let finalContent = '';

  unsubs.push(
    session.on('assistant.message_delta', (e) => {
      emitEvent({ type: 'chunk', sdkMessageId: e.data.messageId, content: e.data.deltaContent });
    }),
  );

  unsubs.push(
    session.on('assistant.message', (e) => {
      if (e.data.content) {
        finalContent = e.data.content;
        emitEvent({
          type: 'message_final',
          sdkMessageId: e.data.messageId,
          content: e.data.content,
        });
      }
    }),
  );

  unsubs.push(
    session.on('assistant.reasoning_delta', (e) => {
      emitEvent({
        type: 'reasoning',
        reasoningId: e.data.reasoningId,
        content: e.data.deltaContent,
      });
    }),
  );

  unsubs.push(
    session.on('tool.execution_start', (e) => {
      emitEvent({
        type: 'tool_start',
        toolCallId: e.data.toolCallId,
        toolName: e.data.toolName,
        args: e.data.arguments,
        parentToolCallId: e.data.parentToolCallId,
      });
    }),
  );

  unsubs.push(
    session.on('tool.execution_progress', (e) => {
      emitEvent({
        type: 'tool_progress',
        toolCallId: e.data.toolCallId,
        message: e.data.progressMessage,
      });
    }),
  );

  unsubs.push(
    session.on('tool.execution_partial_result', (e) => {
      emitEvent({
        type: 'tool_output',
        toolCallId: e.data.toolCallId,
        output: e.data.partialOutput,
      });
    }),
  );

  unsubs.push(
    session.on('tool.execution_complete', (e) => {
      emitEvent({
        type: 'tool_done',
        toolCallId: e.data.toolCallId,
        success: e.data.success,
        result: e.data.result?.content,
        error: e.data.error?.message,
      });
    }),
  );

  // Set up idle/error listeners BEFORE send to avoid missing events
  const turnDone = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, 300_000);

    const unsubIdle = session.on('session.idle', () => {
      clearTimeout(timeout);
      unsubIdle();
      resolve();
    });
    unsubs.push(unsubIdle);

    const unsubError = session.on('session.error', (e) => {
      clearTimeout(timeout);
      unsubError();
      reject(new Error(e.data.message));
    });
    unsubs.push(unsubError);

    abortSignal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });

  let sendTimerId: ReturnType<typeof setTimeout> | undefined;
  const sendTimeout = new Promise<never>((_, reject) => {
    sendTimerId = setTimeout(() => reject(new Error('Session not found')), 30_000);
  });
  try {
    await Promise.race([session.send({ prompt }), sendTimeout]);
  } finally {
    clearTimeout(sendTimerId);
  }

  await turnDone;

  return { finalContent, messageId };
}

// ---------------------------------------------------------------------------
// sendToAgentWithRetry — stale session retry wrapper
// ---------------------------------------------------------------------------

export interface SendToAgentOptions {
  mind: MindContext;
  prompt: string;
  roundId: string;
  context: OrchestrationContext;
  abortSignal: AbortSignal;
  unsubs: (() => void)[];
  orchestrationMode: OrchestrationMode;
  /** Optional content transform (e.g. stripControlJson) applied to display content */
  transformContent?: (raw: string) => string;
}

export interface SendToAgentResult {
  /** The persisted ChatroomMessage, or null if aborted/empty */
  message: ChatroomMessage | null;
  /** Raw final content (before transform) — useful for parsing control directives */
  rawContent: string;
}

/**
 * Get-or-create a session, stream a turn, persist the result.
 * Retries once on stale session errors.
 */
export async function sendToAgentWithRetry(opts: SendToAgentOptions): Promise<SendToAgentResult> {
  const { mind, prompt, roundId, context, abortSignal, orchestrationMode, transformContent } = opts;

  const run = async (session: CopilotSession): Promise<SendToAgentResult> => {
    try {
      const { finalContent, messageId } = await streamAgentTurn({
        session, mind, prompt, roundId, context,
        abortSignal, unsubs: opts.unsubs, orchestrationMode,
      });

      if (abortSignal.aborted) return { message: null, rawContent: finalContent };

      if (finalContent) {
        const displayContent = transformContent ? transformContent(finalContent) : finalContent;
        const msg: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [{ type: 'text', content: displayContent || finalContent }],
          timestamp: Date.now(),
          sender: { mindId: mind.mindId, name: mind.identity.name },
          roundId,
          orchestrationMode,
        };
        context.persistMessage(msg);

        const emitDone = () => {
          if (!abortSignal.aborted) {
            context.emitEvent({
              mindId: mind.mindId,
              mindName: mind.identity.name,
              messageId,
              roundId,
              event: { type: 'done' },
            });
          }
        };
        emitDone();

        return {
          message: msg,
          rawContent: finalContent,
        };
      }

      return { message: null, rawContent: '' };
    } finally {
      for (const unsub of opts.unsubs) unsub();
      opts.unsubs.length = 0;
    }
  };

  const session = await context.getOrCreateSession(mind.mindId);
  try {
    return await run(session);
  } catch (err) {
    if (!isStaleSessionError(err)) throw err;
    context.evictSession(mind.mindId);
    const freshSession = await context.getOrCreateSession(mind.mindId);
    return await run(freshSession);
  }
}
