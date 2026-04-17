import { randomUUID } from 'node:crypto';
import type { MindContext } from '../../../../shared/types';
import type { ChatroomStreamEvent, ChatroomMessage } from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import { isStaleSessionError } from '../../../../shared/sessionErrors';
import type { CopilotSession } from '../../mind';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPE_MAP[ch]);
}

function textContent(msg: ChatroomMessage): string {
  return msg.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { content: string }).content)
    .join('');
}

// ---------------------------------------------------------------------------
// SequentialStrategy — round-robin, each agent speaks in order
// ---------------------------------------------------------------------------

export class SequentialStrategy implements OrchestrationStrategy {
  readonly mode = 'sequential' as const;
  private abortController: AbortController | null = null;
  private currentUnsubs: (() => void)[] = [];

  async execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (participants.length === 0) return;

    this.abortController = new AbortController();
    const roundResponses: ChatroomMessage[] = [];

    for (const mind of participants) {
      if (this.abortController.signal.aborted) break;

      // Build prompt that includes responses from earlier agents in this round
      const prompt = this.buildSequentialPrompt(
        userMessage,
        participants,
        roundResponses,
        context,
      );

      // Emit turn-start orchestration event
      context.emitEvent({
        mindId: mind.mindId,
        mindName: mind.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:turn-start',
          data: { speaker: mind.identity.name, speakerMindId: mind.mindId },
        },
      });

      try {
        const response = await this.sendToAgent(mind, prompt, roundId, context);
        if (response) {
          roundResponses.push(response);
        }
      } catch (err) {
        console.error(`[Sequential] Agent ${mind.mindId} failed:`, err);
        // Continue to next agent — don't break the chain
      }
    }
  }

  stop(): void {
    this.abortController?.abort();
    for (const unsub of this.currentUnsubs) unsub();
    this.currentUnsubs = [];
  }

  // -------------------------------------------------------------------------
  // Prompt building — includes prior agents' responses from this round
  // -------------------------------------------------------------------------

  private buildSequentialPrompt(
    userMessage: string,
    participants: MindContext[],
    roundResponses: ChatroomMessage[],
    context: OrchestrationContext,
  ): string {
    const basePrompt = context.buildBasePrompt(userMessage, participants);

    if (roundResponses.length === 0) {
      return basePrompt;
    }

    // Inject current-round responses before the user message
    let xml = `<sequential-round>\n`;
    for (const msg of roundResponses) {
      xml += `  <response speaker="${escapeXml(msg.sender.name)}">${escapeXml(textContent(msg))}</response>\n`;
    }
    xml += `</sequential-round>\n`;
    xml += `The above are responses from other agents in this round. Build on or respond to their points.\n\n`;

    return xml + basePrompt;
  }

  // -------------------------------------------------------------------------
  // Agent communication
  // -------------------------------------------------------------------------

  private async sendToAgent(
    mind: MindContext,
    prompt: string,
    roundId: string,
    context: OrchestrationContext,
  ): Promise<ChatroomMessage | null> {
    const session = await context.getOrCreateSession(mind.mindId);
    try {
      return await this.streamToAgent(session, mind, prompt, roundId, context);
    } catch (err) {
      if (!isStaleSessionError(err)) throw err;
      context.evictSession(mind.mindId);
      const freshSession = await context.getOrCreateSession(mind.mindId);
      return await this.streamToAgent(freshSession, mind, prompt, roundId, context);
    }
  }

  private async streamToAgent(
    session: CopilotSession,
    mind: MindContext,
    prompt: string,
    roundId: string,
    context: OrchestrationContext,
  ): Promise<ChatroomMessage | null> {
    const messageId = randomUUID();
    const unsubs: (() => void)[] = [];
    this.currentUnsubs = unsubs;

    const emitEvent = (event: ChatroomStreamEvent['event']) => {
      if (!this.abortController?.signal.aborted) {
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

        if (this.abortController) {
          this.abortController.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        }
      });

      if (this.abortController?.signal.aborted) return null;

      if (finalContent) {
        const agentMsg: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [{ type: 'text', content: finalContent }],
          timestamp: Date.now(),
          sender: { mindId: mind.mindId, name: mind.identity.name },
          roundId,
          orchestrationMode: 'sequential',
        };
        context.persistMessage(agentMsg);
        emitEvent({ type: 'done' });
        return agentMsg;
      }

      emitEvent({ type: 'done' });
      return null;
    } catch (err) {
      if (!this.abortController?.signal.aborted) {
        if (isStaleSessionError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        emitEvent({ type: 'error', message });
      }
      return null;
    } finally {
      for (const unsub of unsubs) unsub();
      this.currentUnsubs = [];
    }
  }
}
