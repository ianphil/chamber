import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { ChatroomMessage, ChatroomTranscript, ChatroomStreamEvent } from '../../../shared/chatroom-types';
import type { MindContext } from '../../../shared/types';
import type { CopilotSession } from '../mind';
import { isStaleSessionError } from '../../../shared/sessionErrors';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ChatroomSessionFactory {
  createChatroomSession(mindId: string): Promise<CopilotSession>;
  listMinds(): MindContext[];
  on?(event: string, listener: (...args: any[]) => void): any;
  removeListener?(event: string, listener: (...args: any[]) => void): any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 500;

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
// ChatroomService
// ---------------------------------------------------------------------------

interface InFlightAgent {
  mindId: string;
  abort: AbortController;
  unsubs: (() => void)[];
}

export class ChatroomService extends EventEmitter {
  private messages: ChatroomMessage[] = [];
  private sessionCache = new Map<string, CopilotSession>();
  private inFlight = new Map<string, InFlightAgent>();
  private readonly persistPath: string;
  private readonly persistDir: string;

  constructor(private readonly sessionFactory: ChatroomSessionFactory) {
    super();

    const chamberDir = app.getPath('userData');
    this.persistDir = chamberDir;
    this.persistPath = path.join(chamberDir, 'chatroom.json');

    this.loadTranscript();
    this.listenToFactoryEvents();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async broadcast(userMessage: string, _model?: string): Promise<void> {
    // Cancel any in-flight agents from previous round
    this.stopAll();

    const roundId = randomUUID();

    // Snapshot participants (only ready minds)
    const participants = this.sessionFactory
      .listMinds()
      .filter((m) => m.status === 'ready');

    // Create and persist user message
    const userMsg = this.createUserMessage(userMessage, roundId);
    this.messages.push(userMsg);
    this.persist();

    if (participants.length === 0) return;

    // Build context prompt for this round
    const contextPrompt = this.buildPrompt(userMessage, participants, roundId);

    // Fan out to all participants in parallel
    await Promise.all(
      participants.map((mind) =>
        this.sendToAgent(mind, contextPrompt, roundId).catch((err) => {
          console.error(`[Chatroom] Agent ${mind.mindId} failed:`, err);
        }),
      ),
    );
  }

  stopAll(): void {
    for (const agent of this.inFlight.values()) {
      agent.abort.abort();
      for (const unsub of agent.unsubs) unsub();
      const session = this.sessionCache.get(agent.mindId);
      if (session) session.abort().catch(() => {});
    }
    this.inFlight.clear();
  }

  getHistory(): ChatroomMessage[] {
    return [...this.messages];
  }

  async clearHistory(): Promise<void> {
    this.messages = [];
    this.persist();

    // Destroy all cached sessions
    for (const [id, session] of this.sessionCache) {
      await session.destroy().catch(() => {});
    }
    this.sessionCache.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async sendToAgent(
    mind: MindContext,
    prompt: string,
    roundId: string,
  ): Promise<void> {
    const session = await this.getOrCreateSession(mind.mindId);
    try {
      await this.streamToAgent(session, mind, prompt, roundId);
    } catch (err) {
      if (!isStaleSessionError(err)) throw err;

      // Stale session — evict cache, get a fresh session, retry once
      this.sessionCache.delete(mind.mindId);
      const freshSession = await this.getOrCreateSession(mind.mindId);
      await this.streamToAgent(freshSession, mind, prompt, roundId);
    }
  }

  private async streamToAgent(
    session: CopilotSession,
    mind: MindContext,
    prompt: string,
    roundId: string,
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
        this.emit('chatroom:event', {
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
      // Subscribe to streaming events
      unsubs.push(
        session.on('assistant.message_delta', (e: any) => {
          emitEvent({ type: 'chunk', sdkMessageId: e.data.messageId, content: e.data.deltaContent });
        }),
      );

      unsubs.push(
        session.on('assistant.message', (e: any) => {
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
        session.on('assistant.reasoning_delta', (e: any) => {
          emitEvent({
            type: 'reasoning',
            reasoningId: e.data.reasoningId,
            content: e.data.deltaContent,
          });
        }),
      );

      unsubs.push(
        session.on('tool.execution_start', (e: any) => {
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
        session.on('tool.execution_complete', (e: any) => {
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

      // Wait for idle or error
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 300_000);

        const unsubIdle = session.on('session.idle', () => {
          clearTimeout(timeout);
          unsubIdle();
          resolve();
        });
        unsubs.push(unsubIdle);

        const unsubError = session.on('session.error', (e: any) => {
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

      // Persist agent reply
      if (finalContent) {
        const agentMsg: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [{ type: 'text', content: finalContent }],
          timestamp: Date.now(),
          sender: { mindId: mind.mindId, name: mind.identity.name },
          roundId,
        };
        this.messages.push(agentMsg);
        this.persist();
      }

      emitEvent({ type: 'done' });
    } catch (err) {
      if (!abortController.signal.aborted) {
        // Let stale-session errors propagate for retry in sendToAgent
        if (isStaleSessionError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        emitEvent({ type: 'error', message });
      }
    } finally {
      for (const unsub of unsubs) unsub();
      this.inFlight.delete(mind.mindId);
    }
  }

  private async getOrCreateSession(mindId: string): Promise<CopilotSession> {
    let session = this.sessionCache.get(mindId);
    if (!session) {
      session = await this.sessionFactory.createChatroomSession(mindId);
      this.sessionCache.set(mindId, session as CopilotSession);
    }
    return session;
  }

  private createUserMessage(text: string, roundId: string): ChatroomMessage {
    return {
      id: randomUUID(),
      role: 'user',
      blocks: [{ type: 'text', content: text }],
      timestamp: Date.now(),
      sender: { mindId: 'user', name: 'You' },
      roundId,
    };
  }

  // -------------------------------------------------------------------------
  // Context prompt building
  // -------------------------------------------------------------------------

  private buildPrompt(
    currentMessage: string,
    participants: MindContext[],
    _roundId: string,
  ): string {
    const historyRounds = this.getLastNRounds(2);
    const participantNames = participants.map((p) => p.identity.name).join(', ');

    if (historyRounds.length === 0) {
      return `<message sender="You">${escapeXml(currentMessage)}</message>`;
    }

    let xml = `<chatroom-history participants="${escapeXml(participantNames)}">\n`;
    for (const msg of historyRounds) {
      const sender = msg.sender.name;
      xml += `  <message sender="${escapeXml(sender)}">${escapeXml(textContent(msg))}</message>\n`;
    }
    xml += `</chatroom-history>\n`;
    xml += `Respond only to the following message. The chatroom history above is for context only.\n\n`;
    xml += `<message sender="You">${escapeXml(currentMessage)}</message>`;

    return xml;
  }

  private getLastNRounds(n: number): ChatroomMessage[] {
    // Collect unique roundIds in reverse order, take last n
    const roundIds: string[] = [];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const rid = this.messages[i].roundId;
      if (!roundIds.includes(rid)) {
        roundIds.unshift(rid);
      }
    }

    // Exclude the current round (it's being built now — its user msg is already in this.messages)
    // The last roundId is the current round, so take n rounds before it
    const currentRoundId = roundIds[roundIds.length - 1];
    const previousRoundIds = roundIds.filter((r) => r !== currentRoundId);
    const targetRoundIds = previousRoundIds.slice(-n);

    return this.messages.filter((m) => targetRoundIds.includes(m.roundId));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private loadTranscript(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const transcript: ChatroomTranscript = JSON.parse(raw);
      if (transcript.version === 1 && Array.isArray(transcript.messages)) {
        this.messages = transcript.messages;
      }
    } catch {
      // Corrupt or missing — start fresh
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(this.persistDir, { recursive: true });
      const trimmed = this.messages.slice(-MAX_MESSAGES);
      this.messages = trimmed;
      const transcript: ChatroomTranscript = { version: 1, messages: trimmed };
      const tmpPath = this.persistPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(transcript, null, 2));
      fs.renameSync(tmpPath, this.persistPath);
    } catch {
      // Persistence failure is non-fatal
    }
  }

  // -------------------------------------------------------------------------
  // Factory event listeners
  // -------------------------------------------------------------------------

  private listenToFactoryEvents(): void {
    if (this.sessionFactory.on) {
      this.sessionFactory.on('mind:unloaded', (mindId: string) => {
        this.handleMindUnloaded(mindId);
      });
    }
  }

  private handleMindUnloaded(mindId: string): void {
    // Cancel in-flight if streaming
    const agent = this.inFlight.get(mindId);
    if (agent) {
      agent.abort.abort();
      for (const unsub of agent.unsubs) unsub();
      this.inFlight.delete(mindId);
    }

    // Destroy and remove cached session
    const session = this.sessionCache.get(mindId);
    if (session) {
      session.abort().catch(() => {});
      session.destroy().catch(() => {});
      this.sessionCache.delete(mindId);
    }
  }
}
