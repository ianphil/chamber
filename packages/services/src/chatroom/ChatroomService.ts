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
  ChatroomStateChange,
  OrchestrationMode,
  GroupChatConfig,
  HandoffConfig,
  MagenticConfig,
  TaskLedgerItem,
} from '@chamber/shared/chatroom-types';
import type { MindContext } from '@chamber/shared/types';
import type { CopilotSession } from '../mind';
import type { AppPaths } from '../ports';
import type { PermissionHandler } from '@github/copilot-sdk';
import { escapeXml, textContent, stripControlJson } from '../session-group/shared';
import { ApprovalGate } from '../session-group/approval-gate';
import {
  SessionGroup,
  createApprovalGatePermissionFactory,
  wrapStrategy,
  createStrategy,
} from '../session-group';
import type { ProductHooks } from '../session-group';

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
  private readonly disabledMindIds = new Set<string>();
  private readonly sessionGroup: SessionGroup;
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

    this.sessionGroup = new SessionGroup(
      sessionFactory,
      createApprovalGatePermissionFactory(this.approvalGate),
    );

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

    // Snapshot participants (only ready minds) and apply the user-managed
    // disabled set. Snapshotted once at the top of the round so a toggle
    // mid-round does not affect the in-flight broadcast.
    const readyMinds = this.sessionFactory
      .listMinds()
      .filter((m) => m.status === 'ready');
    const participants = readyMinds.filter((m) => !this.disabledMindIds.has(m.mindId));

    // Create and persist user message
    const userMsg = this.createUserMessage(userMessage, roundId);
    this.messages.push(userMsg);
    this.persist();

    // No enabled participants — emit and persist a system assistant message
    // so the user sees explicit feedback rather than a silent no-op.
    if (participants.length === 0) {
      this.emitSystemMessage(
        roundId,
        readyMinds.length === 0
          ? 'No agents are loaded. Add an agent to start chatting.'
          : 'No agents are enabled. Click an agent at the top to re-enable it.',
      );
      return;
    }

    // Validate orchestration prerequisites against the *enabled* set.
    // Without this, disabling the moderator/manager produces a confusing
    // silent no-op or partial behavior inside the strategy.
    const orchestrationError = this.validateOrchestrationPrerequisites(participants);
    if (orchestrationError) {
      this.emitSystemMessage(roundId, orchestrationError);
      return;
    }

    log.info(`broadcast mode="${this.orchestrationMode}" participants=${participants.length} disabled=${this.disabledMindIds.size} handoffConfig=${JSON.stringify(this.handoffConfig)} magneticConfig=${JSON.stringify(this.magneticConfig)}`);

    // Warm session pool — pre-create sessions for all participants in parallel
    // to eliminate cold-start delays when workers begin their turns.
    await Promise.all(
      participants.map((p) => this.sessionGroup.getOrCreateSession(p.mindId).catch(() => { /* non-fatal */ })),
    );

    // Build the orchestrator for the current mode and wrap it for SessionGroup.
    let orchestrator;
    try {
      const strategy = createStrategy(
        this.orchestrationMode,
        this.groupChatConfig ?? undefined,
        this.handoffConfig ?? undefined,
        this.magneticConfig ?? undefined,
      );
      orchestrator = wrapStrategy(strategy);
    } catch (err) {
      log.error(`Failed to create strategy for mode "${this.orchestrationMode}":`, err);
      this.emitOrchestrationError(roundId, err);
      return;
    }

    try {
      await this.sessionGroup.run({
        prompt: userMessage,
        participants,
        roundId,
        orchestrator,
        product: this.buildProductHooks(roundId),
      });
    } catch (err) {
      log.error(`Strategy "${this.orchestrationMode}" execution failed:`, err);
      this.emitOrchestrationError(roundId, err);
    }
  }

  stopAll(): void {
    // Cancel the active orchestrator (if any) then abort + evict all
    // cached sessions so the next round starts cold.
    this.sessionGroup.stopActiveRun();
    this.sessionGroup.abortAll();
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

  /**
   * Toggle a mind's chatroom participation. Persists synchronously and
   * emits `chatroom:state-changed` so any other windows update too.
   * No-op if the requested state is already the current one.
   */
  setMindEnabled(mindId: string, enabled: boolean): void {
    const wasDisabled = this.disabledMindIds.has(mindId);
    const wantDisabled = !enabled;
    if (wasDisabled === wantDisabled) return;
    if (wantDisabled) {
      this.disabledMindIds.add(mindId);
    } else {
      this.disabledMindIds.delete(mindId);
    }
    this.persist();
    this.emitStateChanged();
  }

  /** Snapshot of currently disabled mind IDs. */
  getDisabledMindIds(): string[] {
    return [...this.disabledMindIds];
  }

  async clearHistory(): Promise<void> {
    this.cancelPendingLedgerPersist();
    this.messages = [];
    this.lastLedger = [];
    this.persist();

    // Destroy all cached sessions
    await this.sessionGroup.destroyAll();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Build the product-shaped hooks SessionGroup hands to the orchestrator
   * each round: prompt building, event emission, message persistence,
   * history access. Bound to the round so `buildBasePrompt` can capture
   * `roundId` for context.
   */
  private buildProductHooks(roundId: string): ProductHooks {
    return {
      buildBasePrompt: (msg, parts, forMind) =>
        this.buildPrompt(msg, parts, roundId, forMind),
      emitEvent: (event) => this.emit('chatroom:event', event),
      persistMessage: (message) => {
        this.messages.push(message);
        this.persist();
      },
      getHistory: () => [...this.messages],
    };
  }

  /** Emit a system-level orchestration error event. */
  private emitOrchestrationError(roundId: string, err: unknown): void {
    this.emit('chatroom:event', {
      mindId: 'system',
      mindName: 'System',
      messageId: randomUUID(),
      roundId,
      event: { type: 'error', message: `Orchestration error: ${err instanceof Error ? err.message : String(err)}` },
    } satisfies ChatroomStreamEvent);
  }

  /**
   * Persist a system assistant message in the transcript and stream it
   * to the renderer in one shot. Used for "no enabled participants" and
   * for orchestration prerequisite failures so the user sees explicit
   * feedback instead of a silent dropped round.
   */
  private emitSystemMessage(roundId: string, text: string): void {
    const messageId = randomUUID();
    const msg: ChatroomMessage = {
      id: messageId,
      role: 'assistant',
      blocks: [{ type: 'text', content: text }],
      timestamp: Date.now(),
      sender: { mindId: 'system', name: 'System' },
      roundId,
    };
    this.messages.push(msg);
    this.persist();
    this.emit('chatroom:event', {
      mindId: 'system',
      mindName: 'System',
      messageId,
      roundId,
      event: { type: 'message_final', content: text, sdkMessageId: messageId },
    } satisfies ChatroomStreamEvent);
    this.emit('chatroom:event', {
      mindId: 'system',
      mindName: 'System',
      messageId,
      roundId,
      event: { type: 'done' },
    } satisfies ChatroomStreamEvent);
  }

  /**
   * Validate that the selected orchestration mode can run with the given
   * (already enabled-filtered) participant set. Returns a user-facing
   * error string if not, otherwise null.
   */
  private validateOrchestrationPrerequisites(participants: MindContext[]): string | null {
    const ids = new Set(participants.map((p) => p.mindId));
    if (this.orchestrationMode === 'group-chat' && this.groupChatConfig) {
      if (!ids.has(this.groupChatConfig.moderatorMindId)) {
        return 'The group-chat moderator is disabled or not loaded. Re-enable it or change the orchestration mode.';
      }
    }
    if (this.orchestrationMode === 'magentic' && this.magneticConfig) {
      if (!ids.has(this.magneticConfig.managerMindId)) {
        return 'The magentic manager is disabled or not loaded. Re-enable it or change the orchestration mode.';
      }
      // Magentic needs at least one worker (a non-manager participant) to assign tasks to.
      const workers = participants.filter((p) => p.mindId !== this.magneticConfig?.managerMindId);
      if (workers.length === 0) {
        return 'Magentic orchestration needs at least one worker enabled in addition to the manager.';
      }
    }
    return null;
  }

  /** Emit an authoritative state-changed event for cross-window sync. */
  private emitStateChanged(): void {
    const payload: ChatroomStateChange = { disabledMindIds: this.getDisabledMindIds() };
    this.emit('chatroom:state-changed', payload);
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
        // Defensive: keep only string entries and don't fail the whole
        // transcript load if the optional preference field is malformed.
        if (Array.isArray(transcript.disabledMindIds)) {
          for (const id of transcript.disabledMindIds) {
            if (typeof id === 'string') this.disabledMindIds.add(id);
          }
        }
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
      const transcript: ChatroomTranscript = {
        version: 1,
        messages: trimmed,
        taskLedger: this.lastLedger,
        disabledMindIds: this.getDisabledMindIds(),
      };
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
    // Cancel active orchestrator (if running) and tear down the unloaded
    // mind's session.
    this.sessionGroup.stopActiveRun();
    this.sessionGroup.destroySession(mindId);

    // Housekeeping: drop the mind from the disabled set so a re-added
    // mind with the same id starts enabled, and the persisted set
    // doesn't accumulate stale ids. Persist + broadcast only if the set
    // actually changed.
    if (this.disabledMindIds.delete(mindId)) {
      this.persist();
      this.emitStateChanged();
    }
  }
}
