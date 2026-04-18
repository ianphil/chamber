import type { MindContext } from '../../../../shared/types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import type { CopilotSession } from '../../mind';
import { isStaleSessionError } from '../../../../shared/sessionErrors';
import { streamAgentTurn } from './stream-agent';

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

    await Promise.all(
      participants.map((mind) => {
        const prompt = context.buildBasePrompt(userMessage, participants, mind);
        return this.sendToAgent(mind, prompt, roundId, context).catch((err) => {
          console.error(`[Chatroom:Concurrent] Agent ${mind.mindId} failed:`, err);
        });
      }),
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
    const abortController = new AbortController();
    const unsubs: (() => void)[] = [];
    const agent: InFlightAgent = { mindId: mind.mindId, abort: abortController, unsubs };
    this.inFlight.set(mind.mindId, agent);

    const run = async (session: CopilotSession) => {
      try {
        const { finalContent, messageId } = await streamAgentTurn({
          session, mind, prompt, roundId, context,
          abortSignal: abortController.signal,
          unsubs,
          orchestrationMode: 'concurrent',
        });

        if (abortController.signal.aborted) return;

        if (finalContent) {
          context.persistMessage({
            id: messageId,
            role: 'assistant',
            blocks: [{ type: 'text', content: finalContent }],
            timestamp: Date.now(),
            sender: { mindId: mind.mindId, name: mind.identity.name },
            roundId,
            orchestrationMode: 'concurrent',
          });
        }

        if (!abortController.signal.aborted) {
          context.emitEvent({
            mindId: mind.mindId,
            mindName: mind.identity.name,
            messageId,
            roundId,
            event: { type: 'done' },
          });
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          if (isStaleSessionError(err)) throw err;
          const message = err instanceof Error ? err.message : String(err);
          context.emitEvent({
            mindId: mind.mindId,
            mindName: mind.identity.name,
            messageId: '',
            roundId,
            event: { type: 'error', message },
          });
        }
      } finally {
        for (const unsub of unsubs) unsub();
        this.inFlight.delete(mind.mindId);
      }
    };

    const session = await context.getOrCreateSession(mind.mindId);
    try {
      await run(session);
    } catch (err) {
      if (!isStaleSessionError(err)) throw err;
      context.evictSession(mind.mindId);
      const freshSession = await context.getOrCreateSession(mind.mindId);
      await run(freshSession);
    }
  }
}
