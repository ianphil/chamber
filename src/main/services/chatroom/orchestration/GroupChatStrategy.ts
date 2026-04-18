import type { MindContext } from '../../../../shared/types';
import type {
  GroupChatConfig,
} from '../../../../shared/chatroom-types';
import type { OrchestrationStrategy, OrchestrationContext } from './types';
import { escapeXml, textContent, extractJsonObject } from './shared';
import { sendToAgentWithRetry } from './stream-agent';

// ---------------------------------------------------------------------------
// Moderator response parsing
// ---------------------------------------------------------------------------

interface ModeratorDecision {
  nextSpeaker: string;
  direction: string;
  action: 'direct' | 'close';
}

function parseModeratorResponse(text: string): ModeratorDecision | null {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const nextSpeaker = typeof parsed.next_speaker === 'string' ? parsed.next_speaker : '';
    const direction = typeof parsed.direction === 'string' ? parsed.direction : '';
    const action = parsed.action === 'close' ? 'close' as const : 'direct' as const;
    return { nextSpeaker, direction, action };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transcript turn tracking
// ---------------------------------------------------------------------------

interface TranscriptTurn {
  speaker: string;
  speakerMindId: string;
  content: string;
  turnNumber: number;
  isModerator: boolean;
}

// ---------------------------------------------------------------------------
// GroupChatStrategy — moderated sequential turn-taking
// ---------------------------------------------------------------------------

export class GroupChatStrategy implements OrchestrationStrategy {
  readonly mode = 'group-chat' as const;
  private abortController: AbortController | null = null;
  private currentUnsubs: (() => void)[] = [];
  private readonly config: GroupChatConfig;

  constructor(config: GroupChatConfig) {
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

    const moderator = participants.find((p) => p.mindId === this.config.moderatorMindId);
    if (!moderator) {
      console.error('[Chatroom:GroupChat] Moderator mind not found among participants');
      return;
    }

    // Non-moderator participants
    const speakers = participants.filter((p) => p.mindId !== this.config.moderatorMindId);
    if (speakers.length === 0) return;

    const transcript: TranscriptTurn[] = [];
    const speakerCounts = new Map<string, number>();
    const spokeMindIds = new Set<string>();
    let turnNumber = 0;

    // Helper: find participant by name (case-insensitive)
    const findSpeaker = (name: string): MindContext | undefined =>
      speakers.find((s) => s.identity.name.toLowerCase() === name.toLowerCase());

    // Helper: find next unheard speaker
    const nextUnheard = (): MindContext =>
      speakers.find((s) => !spokeMindIds.has(s.mindId)) ?? speakers[0];

    // Helper: check if all speakers heard in current cycle
    const allHeardInCycle = (round: number): boolean => {
      const minSpeaks = round;
      return speakers.every((s) => (speakerCounts.get(s.mindId) ?? 0) >= minSpeaks);
    };

    // ── Main deliberation loop ──

    // Opening: Moderator frames the discussion and picks first speaker
    const openingPrompt = this.buildModeratorPrompt(
      userMessage,
      speakers,
      transcript,
      spokeMindIds,
      'open',
    );

    context.emitEvent({
      mindId: moderator.mindId,
      mindName: moderator.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:moderator-decision',
        data: { action: 'open', phase: 'open' },
      },
    });

    let openingResponse;
    try {
      ({ message: openingResponse } = await sendToAgentWithRetry({
        mind: moderator,
        prompt: openingPrompt,
        roundId,
        context,
        abortSignal: this.abortController.signal,
        unsubs: this.currentUnsubs,
        orchestrationMode: 'group-chat',
      }));
    } catch (err) {
      context.emitEvent({
        mindId: moderator.mindId,
        mindName: moderator.identity.name,
        messageId: '',
        roundId,
        event: { type: 'error', message: `Moderator failed: ${err instanceof Error ? err.message : String(err)}` },
      });
      return;
    }

    const openingText = openingResponse ? textContent(openingResponse) : '';
    const openingDecision = parseModeratorResponse(openingText);

    // Record opening in transcript
    transcript.push({
      speaker: moderator.identity.name,
      speakerMindId: moderator.mindId,
      content: openingText,
      turnNumber: 0,
      isModerator: true,
    });

    let nextSpeakerMind: MindContext;
    let nextDirection = '';
    if (openingDecision?.nextSpeaker) {
      const found = findSpeaker(openingDecision.nextSpeaker);
      nextSpeakerMind = found ?? speakers[0];
      nextDirection = openingDecision.direction;
    } else {
      nextSpeakerMind = speakers[0];
    }

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      if (this.abortController.signal.aborted) break;

      turnNumber = turn + 1;
      const speaker = nextSpeakerMind;

      // Emit turn-start
      context.emitEvent({
        mindId: speaker.mindId,
        mindName: speaker.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:turn-start',
          data: { speaker: speaker.identity.name, speakerMindId: speaker.mindId, turnNumber },
        },
      });

      // Build speaker prompt with full transcript context + moderator direction
      const speakerPrompt = this.buildSpeakerPrompt(
        userMessage,
        participants,
        transcript,
        context,
        nextDirection,
        speaker,
      );

      // Invoke speaker
      let response;
      try {
        ({ message: response } = await sendToAgentWithRetry({
          mind: speaker,
          prompt: speakerPrompt,
          roundId,
          context,
          abortSignal: this.abortController.signal,
          unsubs: this.currentUnsubs,
          orchestrationMode: 'group-chat',
        }));
      } catch (err) {
        console.error(`[Chatroom:GroupChat] Speaker ${speaker.mindId} failed:`, err);
        continue; // Skip this turn, let moderator pick next speaker
      }

      if (response) {
        transcript.push({
          speaker: speaker.identity.name,
          speakerMindId: speaker.mindId,
          content: textContent(response),
          turnNumber,
          isModerator: false,
        });
        speakerCounts.set(speaker.mindId, (speakerCounts.get(speaker.mindId) ?? 0) + 1);
        spokeMindIds.add(speaker.mindId);
      }

      if (this.abortController.signal.aborted) break;

      // ── Moderator decision ──
      const completedRounds = Math.min(
        ...speakers.map((s) => speakerCounts.get(s.mindId) ?? 0),
      );
      const canClose = completedRounds >= this.config.minRounds && allHeardInCycle(this.config.minRounds);
      const phase = canClose ? 'may_close' : 'moderate';

      const moderatorPrompt = this.buildModeratorPrompt(
        userMessage,
        speakers,
        transcript,
        spokeMindIds,
        phase,
      );

      let moderatorResponse;
      try {
        ({ message: moderatorResponse } = await sendToAgentWithRetry({
          mind: moderator,
          prompt: moderatorPrompt,
          roundId,
          context,
          abortSignal: this.abortController.signal,
          unsubs: this.currentUnsubs,
          orchestrationMode: 'group-chat',
        }));
      } catch (err) {
        console.error(`[Chatroom:GroupChat] Moderator decision failed:`, err);
        break; // Can't continue without moderator direction
      }

      const moderatorText = moderatorResponse ? textContent(moderatorResponse) : '';
      const decision = parseModeratorResponse(moderatorText);

      // Record moderator turn
      transcript.push({
        speaker: moderator.identity.name,
        speakerMindId: moderator.mindId,
        content: moderatorText,
        turnNumber,
        isModerator: true,
      });

      // Emit moderator decision event
      context.emitEvent({
        mindId: moderator.mindId,
        mindName: moderator.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:moderator-decision',
          data: {
            nextSpeaker: decision?.nextSpeaker ?? '',
            action: decision?.action ?? 'direct',
            direction: decision?.direction ?? '',
            phase,
          },
        },
      });

      // Check for convergence
      if (decision?.action === 'close' && canClose) {
        // Emit convergence event
        context.emitEvent({
          mindId: moderator.mindId,
          mindName: moderator.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:convergence',
            data: { totalTurns: turnNumber, completedRounds },
          },
        });

        // Synthesis step: send full transcript to moderator for summary
        try {
          await this.invokeSynthesis(
            moderator,
            userMessage,
            participants,
            transcript,
            roundId,
            context,
          );
        } catch (err) {
          console.error(`[Chatroom:GroupChat] Synthesis failed:`, err);
        }

        break;
      }

      // Determine next speaker
      nextDirection = decision?.direction ?? '';
      if (decision?.nextSpeaker) {
        const found = findSpeaker(decision.nextSpeaker);
        if (found) {
          // Check max speaker repeats
          const count = speakerCounts.get(found.mindId) ?? 0;
          if (count >= this.config.maxSpeakerRepeats) {
            // Fall back to least-spoken participant
            nextSpeakerMind = this.leastSpoken(speakers, speakerCounts);
          } else {
            nextSpeakerMind = found;
          }
        } else {
          // Unknown speaker name — fall back to next unheard
          nextSpeakerMind = nextUnheard();
        }
      } else {
        // No decision parsed — fall back to next unheard
        nextSpeakerMind = nextUnheard();
      }
    }
  }

  stop(): void {
    this.abortController?.abort();
    for (const unsub of this.currentUnsubs) unsub();
    this.currentUnsubs = [];
  }

  // -------------------------------------------------------------------------
  // Prompt building
  // -------------------------------------------------------------------------

  private buildSpeakerPrompt(
    userMessage: string,
    participants: MindContext[],
    transcript: TranscriptTurn[],
    context: OrchestrationContext,
    moderatorDirection?: string,
    forMind?: MindContext,
  ): string {
    const basePrompt = context.buildBasePrompt(userMessage, participants, forMind);

    if (transcript.length === 0 && !moderatorDirection) {
      return basePrompt;
    }

    let xml = '';

    if (transcript.length > 0) {
      xml += `<group-chat-transcript>\n`;
      for (const turn of transcript) {
        xml += `  <turn speaker="${escapeXml(turn.speaker)}" turn="${turn.turnNumber}">${escapeXml(turn.content)}</turn>\n`;
      }
      xml += `</group-chat-transcript>\n`;
    }

    if (moderatorDirection) {
      xml += `<moderator-direction>${escapeXml(moderatorDirection)}</moderator-direction>\n`;
      xml += `The moderator has asked you to specifically address: ${escapeXml(moderatorDirection)}\n`;
    }

    xml += `You are participating in a moderated group discussion. Respond to the conversation above and address the user's question.\n\n`;

    return xml + basePrompt;
  }

  private buildModeratorPrompt(
    userMessage: string,
    speakers: MindContext[],
    transcript: TranscriptTurn[],
    spokeMindIds: Set<string>,
    phase: 'open' | 'moderate' | 'may_close',
  ): string {
    const participantNames = speakers.map((s) => s.identity.name).join(', ');
    const spokenNames = speakers
      .filter((s) => spokeMindIds.has(s.mindId))
      .map((s) => s.identity.name)
      .join(', ');
    const remainingNames = speakers
      .filter((s) => !spokeMindIds.has(s.mindId))
      .map((s) => s.identity.name)
      .join(', ');

    let xml = `<group-chat-moderation participants="${escapeXml(participantNames)}" phase="${phase}">\n`;
    xml += `  <user-question>${escapeXml(userMessage)}</user-question>\n`;

    if (transcript.length > 0) {
      xml += `  <transcript>\n`;
      for (const turn of transcript) {
        xml += `    <turn speaker="${escapeXml(turn.speaker)}" turn="${turn.turnNumber}">${escapeXml(turn.content)}</turn>\n`;
      }
      xml += `  </transcript>\n`;
    }

    xml += `  <roles-spoken>${escapeXml(spokenNames || 'none')}</roles-spoken>\n`;
    xml += `  <roles-remaining>${escapeXml(remainingNames || 'all: ' + participantNames)}</roles-remaining>\n`;

    xml += `  <instruction>\n`;
    xml += `    YOU ARE THE MODERATOR. Your ONLY job right now is to decide who speaks next.\n`;
    xml += `    DO NOT answer the user's question yourself. DO NOT provide analysis.\n`;
    xml += `    You MUST respond with ONLY a JSON object — no other text, no markdown, no explanation.\n\n`;

    if (phase === 'open') {
      xml += `    This is the OPENING of the discussion. Pick who should speak FIRST and what angle they should address.\n`;
      xml += `    Choose the participant whose expertise is most relevant to the question.\n`;
    } else if (phase === 'may_close') {
      xml += `    All participants have spoken at least the minimum number of rounds.\n`;
      xml += `    If the key issues are sufficiently debated, set action to "close".\n`;
      xml += `    Otherwise, direct a specific follow-up to a participant who should elaborate.\n`;
    } else {
      if (remainingNames) {
        xml += `    Participants not yet heard: ${escapeXml(remainingNames)}. Prioritize them.\n`;
      }
      xml += `    Based on the transcript, identify the most important gap or unresolved tension.\n`;
      xml += `    Direct the next speaker to address something SPECIFIC — not a generic "share your thoughts".\n`;
    }

    xml += `\n    RESPOND WITH EXACTLY THIS JSON FORMAT AND NOTHING ELSE:\n`;
    xml += `    {"next_speaker": "exact participant name", "direction": "specific topic or question for them", "action": "direct"}\n`;
    xml += `    Or to end: {"next_speaker": "", "direction": "summary of why closing", "action": "close"}\n`;
    xml += `  </instruction>\n`;
    xml += `</group-chat-moderation>`;

    return xml;
  }

  // -------------------------------------------------------------------------
  // Synthesis step
  // -------------------------------------------------------------------------

  private async invokeSynthesis(
    moderator: MindContext,
    userMessage: string,
    participants: MindContext[],
    transcript: TranscriptTurn[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (this.abortController?.signal.aborted) return;

    const participantNames = participants.map((p) => p.identity.name).join(', ');

    let xml = `<group-chat-synthesis participants="${escapeXml(participantNames)}">\n`;
    xml += `  <user-question>${escapeXml(userMessage)}</user-question>\n`;
    xml += `  <transcript>\n`;
    for (const turn of transcript) {
      xml += `    <turn speaker="${escapeXml(turn.speaker)}" turn="${turn.turnNumber}">${escapeXml(turn.content)}</turn>\n`;
    }
    xml += `  </transcript>\n`;
    xml += `  <instruction>Synthesize the deliberation above into a concise summary. Highlight areas of agreement, disagreement, and the final recommendation.</instruction>\n`;
    xml += `</group-chat-synthesis>`;

    context.emitEvent({
      mindId: moderator.mindId,
      mindName: moderator.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:synthesis',
        data: { synthesizer: moderator.identity.name },
      },
    });

    await sendToAgentWithRetry({
      mind: moderator,
      prompt: xml,
      roundId,
      context,
      abortSignal: this.abortController?.signal ?? new AbortController().signal,
      unsubs: this.currentUnsubs,
      orchestrationMode: 'group-chat',
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private leastSpoken(
    speakers: MindContext[],
    counts: Map<string, number>,
  ): MindContext {
    let min = Infinity;
    let result = speakers[0];
    for (const s of speakers) {
      const count = counts.get(s.mindId) ?? 0;
      if (count < min) {
        min = count;
        result = s;
      }
    }
    return result;
  }
}
