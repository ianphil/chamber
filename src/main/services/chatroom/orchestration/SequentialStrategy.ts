import type { MindContext } from '../../../../shared/types';
import type { ChatroomMessage } from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import { sendToAgentWithRetry } from './stream-agent';
import { escapeXml, textContent } from './shared';

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
        mind,
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
        const unsubs: (() => void)[] = [];
        this.currentUnsubs = unsubs;
        const { message } = await sendToAgentWithRetry({
          mind, prompt, roundId, context,
          abortSignal: this.abortController.signal,
          unsubs,
          orchestrationMode: 'sequential',
        });
        if (message) {
          roundResponses.push(message);
        }
      } catch (err) {
        console.error(`[Chatroom:Sequential] Agent ${mind.mindId} failed:`, err);
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
    forMind?: MindContext,
  ): string {
    const basePrompt = context.buildBasePrompt(userMessage, participants, forMind);

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
}
