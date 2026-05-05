import { EventEmitter } from 'events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logger';

const log = Logger.create('Chatroom');
import type {
  ChatroomMessage,
  ChatroomTranscript,
  ChatroomStreamEvent,
  OrchestrationMode,
  GroupChatConfig,
  HandoffConfig,
  MagenticConfig,
  TaskLedgerItem,
} from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';
import type { CopilotSession } from '../mind';
import type { AppPaths } from '../ports';
import type { PermissionHandler, PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';
import { createStrategy } from './orchestration';
import type { OrchestrationStrategy, OrchestrationContext } from './orchestration';
import { escapeXml, textContent, stripControlJson } from './orchestration/shared';
import { ApprovalGate } from './orchestration/approval-gate';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ChatroomSessionFactory {
  createChatroomSession(mindId: string, onPermissionRequest?: PermissionHandler): Promise<CopilotSession>;
  listMinds(): MindContext[];
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 500;

// ---------------------------------------------------------------------------
// ChatroomService
// ---------------------------------------------------------------------------

export class ChatroomService extends EventEmitter {
  private messages: ChatroomMessage[] = [];
  private lastLedger: TaskLedgerItem[] = [];
  private sessionCache = new Map<string, CopilotSession>();
  private activeStrategy: OrchestrationStrategy | null = null;
  private orchestrationMode: OrchestrationMode = 'concurrent';
  private groupChatConfig: GroupChatConfig | null = null;
  private handoffConfig: HandoffConfig | null = null;
  private magneticConfig: MagenticConfig | null = null;
  private readonly persistPath: string;
  private readonly persistDir: string;
  private ledgerPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly LEDGER_PERSIST_DEBOUNCE_MS = 500;

  constructor(
    private readonly sessionFactory: ChatroomSessionFactory,
    appPaths: AppPaths,
    private readonly approvalGate = new ApprovalGate(),
  ) {
    super();

    const chamberDir = appPaths.userData;
    this.persistDir = chamberDir;
    this.persistPath = path.join(chamberDir, 'chatroom.json');

    this.loadTranscript();
    this.listenToFactoryEvents();

    // Track ledger updates for persistence across view switches.
    // Magentic orchestration emits one task-ledger-update per task transition
    // and per parallel-worker completion — debounce to avoid blocking the
    // main thread with sync writeFileSync on every event.
    this.on('chatroom:event', (event: ChatroomStreamEvent) => {
      if (event.event.type === 'orchestration:task-ledger-update') {
        const data = event.event.data as { ledger?: TaskLedgerItem[] };
        if (data.ledger) {
          this.lastLedger = data.ledger;
          this.schedulePersist();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async broadcast(userMessage: string, _model?: string, suppliedRoundId?: string): Promise<void> {
    void _model;
    // Cancel any in-flight agents from previous round
    this.stopAll();

    // Drop any pending debounced ledger write — we're starting a new round
    // and will write the cleared ledger below.
    this.cancelPendingLedgerPersist();

    // Clear stale task ledger from previous orchestration round
    // (persisted alongside user message below)
    this.lastLedger = [];

    const roundId = this.resolveRoundId(suppliedRoundId);

    // Snapshot participants (only ready minds)
    const participants = this.sessionFactory
      .listMinds()
      .filter((m) => m.status === 'ready');

    // Create and persist user message
    const userMsg = this.createUserMessage(userMessage, roundId);
    this.messages.push(userMsg);
    this.persist();

    if (participants.length === 0) return;

    log.info(`broadcast mode="${this.orchestrationMode}" participants=${participants.length} handoffConfig=${JSON.stringify(this.handoffConfig)} magneticConfig=${JSON.stringify(this.magneticConfig)}`);

    // Warm session pool — pre-create sessions for all participants in parallel
    // to eliminate cold-start delays when workers begin their turns.
    await Promise.all(
      participants.map((p) => this.getOrCreateSession(p.mindId).catch(() => { /* non-fatal */ })),
    );

    // Create strategy for current orchestration mode
    let strategy: OrchestrationStrategy;
    try {
      strategy = createStrategy(
        this.orchestrationMode,
        this.groupChatConfig ?? undefined,
        this.handoffConfig ?? undefined,
        this.magneticConfig ?? undefined,
      );
    } catch (err) {
      log.error(`Failed to create strategy for mode "${this.orchestrationMode}":`, err);
      this.emit('chatroom:event', {
        mindId: 'system',
        mindName: 'System',
        messageId: randomUUID(),
        roundId,
        event: { type: 'error', message: `Orchestration error: ${err instanceof Error ? err.message : String(err)}` },
      } satisfies ChatroomStreamEvent);
      return;
    }
    this.activeStrategy = strategy;

    // Build context adapter for strategies
    const contextAdapter: OrchestrationContext = {
      getOrCreateSession: (mindId: string) => this.getOrCreateSession(mindId),
      evictSession: (mindId: string) => this.evictSession(mindId),
      buildBasePrompt: (msg: string, parts: MindContext[], forMind?: MindContext) =>
        this.buildPrompt(msg, parts, roundId, forMind),
      emitEvent: (event: ChatroomStreamEvent) => this.emit('chatroom:event', event),
      persistMessage: (message: ChatroomMessage) => {
        this.messages.push(message);
        this.persist();
      },
      getHistory: () => [...this.messages],
      orchestrationMode: this.orchestrationMode,
    };

    try {
      await strategy.execute(userMessage, participants, roundId, contextAdapter);
    } catch (err) {
      log.error(`Strategy "${this.orchestrationMode}" execution failed:`, err);
      this.emit('chatroom:event', {
        mindId: 'system',
        mindName: 'System',
        messageId: randomUUID(),
        roundId,
        event: { type: 'error', message: `Orchestration error: ${err instanceof Error ? err.message : String(err)}` },
      } satisfies ChatroomStreamEvent);
    }
  }

  stopAll(): void {
    if (this.activeStrategy) {
      this.activeStrategy.stop();
      this.activeStrategy = null;
    }
    // Abort and evict all cached sessions so next round gets fresh ones
    for (const [, session] of this.sessionCache) {
      session.abort().catch(() => { /* noop */ });
    }
    this.sessionCache.clear();
  }

  setOrchestration(mode: OrchestrationMode, config?: GroupChatConfig | HandoffConfig | MagenticConfig): void {
    this.orchestrationMode = mode;
    this.groupChatConfig = null;
    this.handoffConfig = null;
    this.magneticConfig = null;
    if (mode === 'group-chat' && config && 'moderatorMindId' in config && 'maxTurns' in config) {
      this.groupChatConfig = config as GroupChatConfig;
    } else if (mode === 'handoff' && config && 'maxHandoffHops' in config) {
      this.handoffConfig = config as HandoffConfig;
    } else if (mode === 'magentic' && config && 'managerMindId' in config && 'maxSteps' in config) {
      this.magneticConfig = config as MagenticConfig;
    }
  }

  getOrchestration(): { mode: OrchestrationMode; config: GroupChatConfig | HandoffConfig | MagenticConfig | null } {
    return {
      mode: this.orchestrationMode,
      config: this.groupChatConfig ?? this.handoffConfig ?? this.magneticConfig,
    };
  }

  getHistory(): ChatroomMessage[] {
    return [...this.messages];
  }

  getTaskLedger(): TaskLedgerItem[] {
    return [...this.lastLedger];
  }

  async clearHistory(): Promise<void> {
    this.cancelPendingLedgerPersist();
    this.messages = [];
    this.lastLedger = [];
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
      session = await this.sessionFactory.createChatroomSession(
        mindId,
        this.createPermissionHandler(mindId),
      );
      this.sessionCache.set(mindId, session as CopilotSession);
    }
    return session;
  }

  private createPermissionHandler(mindId: string): PermissionHandler {
    return async (
      request: PermissionRequest,
      invocation: { sessionId: string },
    ): Promise<PermissionRequestResult> => {
      const toolName = this.permissionToolName(request);
      const { approved, reason } = await this.approvalGate.gate(
        mindId,
        toolName,
        {
          kind: request.kind,
          toolCallId: request.toolCallId,
          sessionId: invocation.sessionId,
        },
        `Copilot requested permission for ${request.kind}`,
      );

      if (approved) {
        return { kind: 'approve-once' };
      }

      return {
        kind: 'reject',
        feedback: reason
          ? `Denied by Chamber approval gate: ${reason}`
          : 'Denied by Chamber approval gate',
      };
    };
  }

  private permissionToolName(request: PermissionRequest): string {
    switch (request.kind) {
      case 'custom-tool':
        return 'custom_tool';
      case 'mcp':
        return 'mcp_tool';
      default:
        return request.kind;
    }
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

  private resolveRoundId(supplied: string | undefined): string {
    if (supplied === undefined) return randomUUID();
    if (this.messages.some((m) => m.roundId === supplied)) {
      log.warn(`broadcast received duplicate roundId "${supplied}"; generating a fresh id`);
      return randomUUID();
    }
    return supplied;
  }

  // -------------------------------------------------------------------------
  // Context prompt building
  // -------------------------------------------------------------------------

  private buildPrompt(
    currentMessage: string,
    participants: MindContext[],
    roundId: string,
    forMind?: MindContext,
  ): string {
    void roundId;
    const historyRounds = this.getLastNRounds(2);
    const participantNames = participants.map((p) => p.identity.name).join(', ');

    // Identity reminder so each agent stays in character
    const identityPrefix = forMind
      ? `<identity>You are ${escapeXml(forMind.identity.name)}. Stay in character. Respond as this persona would — use their voice, perspective, and expertise. Do not break character or sound like the other participants.</identity>\n\n`
      : '';

    if (historyRounds.length === 0) {
      return `${identityPrefix}<message sender="You">${escapeXml(currentMessage)}</message>`;
    }

    let xml = identityPrefix;
    xml += `<chatroom-history participants="${escapeXml(participantNames)}">\n`;
    for (const msg of historyRounds) {
      const sender = msg.sender.name;
      // Strip orchestration control JSON (manager directives, handoff decisions)
      // so workers don't see structured commands from other agents in their context
      const content = stripControlJson(
        textContent(msg),
        (a) => ['assign', 'complete', 'update-plan', 'handoff', 'done', 'direct', 'close'].includes(a as string),
      );
      xml += `  <message sender="${escapeXml(sender)}">${escapeXml(content)}</message>\n`;
    }
    xml += `</chatroom-history>\n`;
    xml += `Respond only to the following message. The chatroom history above is for context only.\n\n`;
    xml += `<message sender="You">${escapeXml(currentMessage)}</message>`;

    return xml;
  }

  private getLastNRounds(n: number): ChatroomMessage[] {
    const seen = new Set<string>();
    const roundIds: string[] = [];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const rid = this.messages[i].roundId;
      if (!seen.has(rid)) {
        seen.add(rid);
        roundIds.unshift(rid);
      }
    }

    // Exclude the current round (it's being built now — its user msg is already in this.messages)
    // The last roundId is the current round, so take n rounds before it
    const currentRoundId = roundIds[roundIds.length - 1];
    const targetRoundIds = new Set(
      roundIds.filter((r) => r !== currentRoundId).slice(-n),
    );

    return this.messages.filter((m) => targetRoundIds.has(m.roundId));
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
        this.lastLedger = Array.isArray(transcript.taskLedger) ? transcript.taskLedger : [];
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
      const transcript: ChatroomTranscript = { version: 1, messages: trimmed, taskLedger: this.lastLedger };
      const tmpPath = this.persistPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(transcript, null, 2));
      fs.renameSync(tmpPath, this.persistPath);
    } catch {
      // Persistence failure is non-fatal
    }
  }

  /**
   * Schedules a debounced persist for ledger updates so a burst of
   * orchestration:task-ledger-update events results in at most one disk write.
   */
  private schedulePersist(): void {
    if (this.ledgerPersistTimer) return;
    this.ledgerPersistTimer = setTimeout(() => {
      this.ledgerPersistTimer = null;
      this.persist();
    }, ChatroomService.LEDGER_PERSIST_DEBOUNCE_MS);
    // Don't keep the event loop alive for a pending ledger flush.
    this.ledgerPersistTimer.unref?.();
  }

  /**
   * Cancel any pending debounced ledger persist (does NOT trigger a write).
   * Call this when you're about to overwrite the ledger anyway, so the
   * debounced timer doesn't write stale state on top of fresh state.
   */
  private cancelPendingLedgerPersist(): void {
    if (this.ledgerPersistTimer) {
      clearTimeout(this.ledgerPersistTimer);
      this.ledgerPersistTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Factory event listeners
  // -------------------------------------------------------------------------

  private listenToFactoryEvents(): void {
    if (this.sessionFactory.on) {
      // MindManager's EventEmitter uses Node's generic listener signature `(...args: unknown[])`,
      // so we unpack the first argument positionally. Runtime payload is always `mindId: string`
      // as emitted from MindManager.unloadMind.
      this.sessionFactory.on('mind:unloaded', (...args: unknown[]) => {
        this.handleMindUnloaded(args[0] as string);
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
