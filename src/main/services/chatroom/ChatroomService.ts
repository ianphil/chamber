import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type {
  ChatroomMessage,
  ChatroomTranscript,
  ChatroomStreamEvent,
  OrchestrationMode,
  GroupChatConfig,
} from '../../../shared/chatroom-types';
import type { MindContext } from '../../../shared/types';
import type { CopilotSession } from '../mind';
import { createStrategy } from './orchestration';
import type { OrchestrationStrategy, OrchestrationContext } from './orchestration';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ChatroomSessionFactory {
  createChatroomSession(mindId: string): Promise<CopilotSession>;
  listMinds(): MindContext[];
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
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

export class ChatroomService extends EventEmitter {
  private messages: ChatroomMessage[] = [];
  private sessionCache = new Map<string, CopilotSession>();
  private activeStrategy: OrchestrationStrategy | null = null;
  private orchestrationMode: OrchestrationMode = 'concurrent';
  private groupChatConfig: GroupChatConfig | null = null;
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
    void _model;
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

    // Create strategy for current orchestration mode
    const strategy = createStrategy(this.orchestrationMode, this.groupChatConfig ?? undefined);
    this.activeStrategy = strategy;

    // Build context adapter for strategies
    const contextAdapter: OrchestrationContext = {
      getOrCreateSession: (mindId: string) => this.getOrCreateSession(mindId),
      evictSession: (mindId: string) => this.evictSession(mindId),
      buildBasePrompt: (msg: string, parts: MindContext[]) =>
        this.buildPrompt(msg, parts, roundId),
      emitEvent: (event: ChatroomStreamEvent) => this.emit('chatroom:event', event),
      persistMessage: (message: ChatroomMessage) => {
        this.messages.push(message);
        this.persist();
      },
      getHistory: () => [...this.messages],
      orchestrationMode: this.orchestrationMode,
    };

    await strategy.execute(userMessage, participants, roundId, contextAdapter);
  }

  stopAll(): void {
    if (this.activeStrategy) {
      this.activeStrategy.stop();
      this.activeStrategy = null;
    }
    // Also abort cached sessions for safety
    for (const [, session] of this.sessionCache) {
      session.abort().catch(() => { /* noop */ });
    }
  }

  setOrchestration(mode: OrchestrationMode, config?: GroupChatConfig): void {
    this.orchestrationMode = mode;
    this.groupChatConfig = config ?? null;
  }

  getOrchestration(): { mode: OrchestrationMode; config: GroupChatConfig | null } {
    return { mode: this.orchestrationMode, config: this.groupChatConfig };
  }

  getHistory(): ChatroomMessage[] {
    return [...this.messages];
  }

  async clearHistory(): Promise<void> {
    this.messages = [];
    this.persist();

    // Destroy all cached sessions
    for (const [, session] of this.sessionCache) {
      await session.destroy().catch(() => { /* noop */ });
    }
    this.sessionCache.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async getOrCreateSession(mindId: string): Promise<CopilotSession> {
    let session = this.sessionCache.get(mindId);
    if (!session) {
      session = await this.sessionFactory.createChatroomSession(mindId);
      this.sessionCache.set(mindId, session as CopilotSession);
    }
    return session;
  }

  /** Evict a cached session (called by strategies on stale-session errors) */
  evictSession(mindId: string): void {
    this.sessionCache.delete(mindId);
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
    roundId: string,
  ): string {
    void roundId;
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
    // Cancel active strategy if running
    if (this.activeStrategy) {
      this.activeStrategy.stop();
      this.activeStrategy = null;
    }

    // Destroy and remove cached session
    const session = this.sessionCache.get(mindId);
    if (session) {
      session.abort().catch(() => { /* noop */ });
      session.destroy().catch(() => { /* noop */ });
      this.sessionCache.delete(mindId);
    }
  }
}
