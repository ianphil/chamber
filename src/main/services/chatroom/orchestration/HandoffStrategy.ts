import type { MindContext } from '../../../../shared/types';
import type {
  ChatroomMessage,
  HandoffConfig,
  HandoffTerminationReason,
} from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import { ObservabilityEmitter } from './observability';
import { escapeXml, extractJsonObject, stripControlJson } from './shared';
import { sendToAgentWithRetry } from './stream-agent';

// ---------------------------------------------------------------------------
// Handoff response parsing
// ---------------------------------------------------------------------------

interface HandoffDecision {
  action: 'handoff' | 'done';
  targetAgent?: string;
  reason: string;
  taskContext?: string;
}

function parseHandoffResponse(text: string): HandoffDecision | null {
  const json = extractJsonObject(text);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.action !== 'handoff' && parsed.action !== 'done') return null;
    const action = parsed.action === 'done' ? 'done' as const : 'handoff' as const;
    const targetAgent = typeof parsed.target_agent === 'string' ? parsed.target_agent : undefined;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    const taskContext = typeof parsed.task_context === 'string' ? parsed.task_context : undefined;
    return { action, targetAgent, reason, taskContext };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transcript for handoff context preservation
// ---------------------------------------------------------------------------

interface HandoffTurn {
  speaker: string;
  speakerMindId: string;
  content: string;
  hopNumber: number;
}

// ---------------------------------------------------------------------------
// HandoffStrategy — agent-to-agent delegation with safety limits
// ---------------------------------------------------------------------------

export class HandoffStrategy implements OrchestrationStrategy {
  readonly mode = 'handoff' as const;
  private abortController: AbortController | null = null;
  private currentUnsubs: (() => void)[] = [];
  private readonly config: HandoffConfig;

  constructor(config: HandoffConfig) {
    this.config = config;
  }

  async execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (participants.length === 0) return;

    this.abortController = new AbortController();

    const obs = new ObservabilityEmitter('handoff');
    obs.start({ participantCount: participants.length, maxHops: this.config.maxHandoffHops });

    // Resolve initial agent
    let currentAgent = this.config.initialMindId
      ? participants.find((p) => p.mindId === this.config.initialMindId) ?? participants[0]
      : participants[0];

    const visitedSequence: string[] = [];
    const transcript: HandoffTurn[] = [];
    let terminationReason: HandoffTerminationReason = 'MAX_HOPS';

    const findAgent = (name: string): MindContext | undefined =>
      participants.find((p) => p.identity.name.toLowerCase() === name.toLowerCase());

    for (let hop = 0; hop < this.config.maxHandoffHops; hop++) {
      if (this.abortController.signal.aborted) {
        terminationReason = 'CANCELLED';
        break;
      }

      // Loop detection: check if current agent already appears in recent sequence
      if (this.detectLoop(visitedSequence, currentAgent.mindId)) {
        terminationReason = 'LOOP_DETECTED';

        context.emitEvent({
          mindId: currentAgent.mindId,
          mindName: currentAgent.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:handoff-terminated',
            data: { reason: 'LOOP_DETECTED', hop, visitedSequence: [...visitedSequence] },
          },
        });

        obs.terminationReason('LOOP_DETECTED', { hop, visitedSequence });
        break;
      }

      visitedSequence.push(currentAgent.mindId);

      // Emit turn-start
      context.emitEvent({
        mindId: currentAgent.mindId,
        mindName: currentAgent.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:turn-start',
          data: {
            speaker: currentAgent.identity.name,
            speakerMindId: currentAgent.mindId,
            hop,
          },
        },
      });

      obs.agentStep(currentAgent.mindId, { hop });

      // Build prompt with handoff context
      const prompt = this.buildHandoffPrompt(
        userMessage,
        participants,
        transcript,
        context,
        hop === 0,
        currentAgent,
      );

      // Invoke agent
      let response: ChatroomMessage | null = null;
      let rawContent = '';
      try {
        ({ message: response, rawContent } = await sendToAgentWithRetry({
          mind: currentAgent,
          prompt,
          roundId,
          context,
          abortSignal: this.abortController.signal,
          unsubs: this.currentUnsubs,
          orchestrationMode: 'handoff',
          transformContent: (raw) => stripControlJson(raw, (a) => a === 'handoff' || a === 'done'),
        }));
      } catch (err) {
        terminationReason = 'ERROR';
        obs.failure(String(err), { hop, mindId: currentAgent.mindId });

        context.emitEvent({
          mindId: currentAgent.mindId,
          mindName: currentAgent.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:handoff-terminated',
            data: { reason: 'ERROR', error: String(err), hop },
          },
        });
        break;
      }

      if (!response) {
        terminationReason = this.abortController.signal.aborted ? 'CANCELLED' : 'ERROR';
        break;
      }

      // Record in transcript
      transcript.push({
        speaker: currentAgent.identity.name,
        speakerMindId: currentAgent.mindId,
        content: rawContent,
        hopNumber: hop,
      });

      // Parse for handoff directive
      const decision = parseHandoffResponse(rawContent);

      if (!decision || decision.action === 'done') {
        terminationReason = 'DONE';

        context.emitEvent({
          mindId: currentAgent.mindId,
          mindName: currentAgent.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:handoff-terminated',
            data: {
              reason: 'DONE',
              hop,
              finalAgent: currentAgent.identity.name,
            },
          },
        });

        obs.terminationReason('DONE', { hop });
        break;
      }

      // Handoff to next agent
      if (decision.targetAgent) {
        const nextAgent = findAgent(decision.targetAgent);
        if (nextAgent) {
          context.emitEvent({
            mindId: currentAgent.mindId,
            mindName: currentAgent.identity.name,
            messageId: '',
            roundId,
            event: {
              type: 'orchestration:handoff',
              data: {
                from: currentAgent.identity.name,
                fromMindId: currentAgent.mindId,
                to: nextAgent.identity.name,
                toMindId: nextAgent.mindId,
                reason: decision.reason,
                hop,
              },
            },
          });

          currentAgent = nextAgent;
        } else {
          // Target not found — treat as done
          terminationReason = 'DONE';
          obs.terminationReason('DONE', { hop, unknownTarget: decision.targetAgent });
          break;
        }
      } else {
        // No target specified — treat as done
        terminationReason = 'DONE';
        break;
      }
    }

    // If we exhausted hops without terminating
    if (terminationReason === 'MAX_HOPS') {
      context.emitEvent({
        mindId: currentAgent.mindId,
        mindName: currentAgent.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:handoff-terminated',
          data: { reason: 'MAX_HOPS', maxHops: this.config.maxHandoffHops },
        },
      });

      obs.terminationReason('MAX_HOPS', { maxHops: this.config.maxHandoffHops });
    }

    obs.end({ terminationReason, totalHops: visitedSequence.length });
  }

  stop(): void {
    this.abortController?.abort();
    for (const unsub of this.currentUnsubs) unsub();
    this.currentUnsubs = [];
  }

  // -------------------------------------------------------------------------
  // Loop detection — A→B→A or A→B→C→A patterns
  // -------------------------------------------------------------------------

  private detectLoop(visited: string[], candidate: string): boolean {
    if (visited.length < 2) return false;
    // Check if the candidate would create a cycle in the last 3 entries
    const recent = visited.slice(-2);
    return recent.includes(candidate);
  }

  // -------------------------------------------------------------------------
  // Prompt building
  // -------------------------------------------------------------------------

  private buildHandoffPrompt(
    userMessage: string,
    participants: MindContext[],
    transcript: HandoffTurn[],
    context: OrchestrationContext,
    isInitial: boolean,
    forMind?: MindContext,
  ): string {
    const basePrompt = context.buildBasePrompt(userMessage, participants, forMind);
    const participantNames = participants.map((p) => p.identity.name).join(', ');

    let xml = '';

    if (transcript.length > 0) {
      xml += `<handoff-transcript>\n`;
      for (const turn of transcript) {
        xml += `  <turn speaker="${escapeXml(turn.speaker)}" hop="${turn.hopNumber}">${escapeXml(turn.content)}</turn>\n`;
      }
      xml += `</handoff-transcript>\n\n`;
    }

    xml += `<handoff-context participants="${escapeXml(participantNames)}" is-initial="${isInitial}">\n`;
    xml += `  <user-question>${escapeXml(userMessage)}</user-question>\n`;
    xml += `  <instruction>\n`;
    xml += `    You are in a handoff orchestration. After answering, decide whether to:\n`;
    xml += `    1. Complete the task (action: "done") — if you have fully addressed the question.\n`;
    xml += `    2. Hand off to another agent (action: "handoff") — if another participant is better suited.\n\n`;
    xml += `    Available participants: ${escapeXml(participantNames)}\n\n`;
    xml += `    First provide your response to the user's question, then on a NEW LINE output EXACTLY this JSON:\n`;
    xml += `    {"action": "done", "reason": "why task is complete"}\n`;
    xml += `    OR\n`;
    xml += `    {"action": "handoff", "target_agent": "exact agent name", "reason": "why handing off", "task_context": "summary for next agent"}\n`;
    xml += `  </instruction>\n`;
    xml += `</handoff-context>\n\n`;

    return xml + basePrompt;
  }
}
