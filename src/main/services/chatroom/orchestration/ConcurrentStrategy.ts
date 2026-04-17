import { randomUUID } from 'node:crypto';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, ChatroomMessage } from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import { isStaleSessionError } from '../../../../shared/sessionErrors';
import type { CopilotSession } from '../../mind';

// ---------------------------------------------------------------------------
// In-flight agent tracking
// ---------------------------------------------------------------------------

interface InFlightAgent {
  mindId: string;
  abort: AbortController;
  unsubs: (() => void)[];
}

// ---------------------------------------------------------------------------
// ConcurrentStrategy — fan out to all participants in parallel
// ---------------------------------------------------------------------------

export class ConcurrentStrategy implements OrchestrationStrategy {
  readonly mode = 'concurrent' as const;
  private inFlight = new Map<string, InFlightAgent>();

  async execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (participants.length === 0) return;

    const contextPrompt = context.buildBasePrompt(userMessage, participants);

    await Promise.all(
      participants.map((mind) =>
        this.sendToAgent(mind, contextPrompt, roundId, context).catch((err) => {
          console.error(`[Chatroom] Agent ${mind.mindId} failed:`, err);
        }),
      ),
    );
  }

  stop(): void {
    for (const agent of this.inFlight.values()) {
      agent.abort.abort();
      for (const unsub of agent.unsubs) unsub();
    }
    this.inFlight.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async sendToAgent(
    mind: MindContext,
    prompt: string,
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    const session = await context.getOrCreateSession(mind.mindId);
    try {
      await this.streamToAgent(session, mind, prompt, roundId, context);
    } catch (err) {
      if (!isStaleSessionError(err)) throw err;
      // Stale session — evict cache, get a fresh session, retry once
      context.evictSession(mind.mindId);
      const freshSession = await context.getOrCreateSession(mind.mindId);
      await this.streamToAgent(freshSession, mind, prompt, roundId, context);
    }
  }

  private async streamToAgent(
    session: CopilotSession,
    mind: MindContext,
    prompt: string,
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    const messageId = randomUUID();
    const abortController = new AbortController();

    const unsubs: (() => void)[] = [];
    const agent: InFlightAgent = { mindId: mind.mindId, abort: abortController, unsubs };
    this.inFlight.set(mind.mindId, agent);

    const guard = (fn: () => void) => {
      if (!abortController.signal.aborted) fn();
    };

    const emitEvent = (event: ChatroomStreamEvent['event']) => {
      guard(() => {
        context.emitEvent({
          mindId: mind.mindId,
          mindName: mind.identity.name,
          messageId,
          roundId,
          event,
        } satisfies ChatroomStreamEvent);
      });
    };

    let finalContent = '';

    try {
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

      await session.send({ prompt });

      await new Promise<void>((resolve, reject) => {
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

        abortController.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });

      if (abortController.signal.aborted) return;

      if (finalContent) {
        const agentMsg: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [{ type: 'text', content: finalContent }],
          timestamp: Date.now(),
          sender: { mindId: mind.mindId, name: mind.identity.name },
          roundId,
          orchestrationMode: 'concurrent',
        };
        context.persistMessage(agentMsg);
      }

      emitEvent({ type: 'done' });
    } catch (err) {
      if (!abortController.signal.aborted) {
        if (isStaleSessionError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        emitEvent({ type: 'error', message });
      }
    } finally {
      for (const unsub of unsubs) unsub();
      this.inFlight.delete(mind.mindId);
    }
  }
}
