import { EventEmitter } from 'events';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logger';

const log = Logger.create('Chatroom');
import type {
  ChatroomMessage,
  ChatroomSessionSummary,
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
import { ChatroomSessionStore } from './ChatroomSessionStore';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ChatroomSessionFactory {
  createChatroomSession(mindId: string, onPermissionRequest?: PermissionHandler): Promise<CopilotSession>;
  setMindModel?(mindId: string, model: string | null): Promise<MindContext | null>;
  listMinds(): MindContext[];
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 500;
const DEFAULT_AUTOCREATE_TITLE = 'New chatroom';

// ---------------------------------------------------------------------------
// Per-session in-memory state
// ---------------------------------------------------------------------------

/**
 * Transcript-scoped state for one named chatroom session. Kept in memory
 * for the active session; persisted via {@link ChatroomSessionStore} on
 * each mutation.
 */
interface SessionState {
  sessionId: string;
  messages: ChatroomMessage[];
  lastLedger: TaskLedgerItem[];
  disabledMindIds: Set<string>;
}

// ---------------------------------------------------------------------------
// ChatroomService
// ---------------------------------------------------------------------------

export class ChatroomService extends EventEmitter {
  private readonly sessionStore: ChatroomSessionStore;
  /** In-memory state for the active session (and any recently-loaded ones). */
  private readonly sessionStates = new Map<string, SessionState>();
  private activeSessionId: string | null = null;

  private readonly sessionGroup: SessionGroup;
  private orchestrationMode: OrchestrationMode = 'concurrent';
  private groupChatConfig: GroupChatConfig | null = null;
  private handoffConfig: HandoffConfig | null = null;
  private magneticConfig: MagenticConfig | null = null;

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

    this.sessionStore = new ChatroomSessionStore(appPaths.userData);
    this.sessionStore.initialize();
    this.restoreActiveSessionIfAny();
    this.listenToFactoryEvents();

    // Track ledger updates for persistence across view switches.
    // Magentic orchestration emits one task-ledger-update per task transition
    // and per parallel-worker completion -- debounce to avoid blocking the
    // main thread with sync writeFileSync on every event.
    this.on('chatroom:event', (event: ChatroomStreamEvent) => {
      if (event.event.type === 'orchestration:task-ledger-update') {
        const data = event.event.data as { ledger?: TaskLedgerItem[] };
        if (data.ledger) {
          const state = this.activeStateOrNull();
          if (state) {
            state.lastLedger = data.ledger;
            this.schedulePersist();
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Snapshot of every persisted session (newest first). */
  listSessions(): ChatroomSessionSummary[] {
    return this.sessionStore.list();
  }

  /** Create a new empty session. Does not change the active session. */
  createSession(title?: string): ChatroomSessionSummary {
    const record = this.sessionStore.create({ title: title?.trim() || DEFAULT_AUTOCREATE_TITLE });
    return {
      sessionId: record.sessionId,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      active: this.activeSessionId === record.sessionId,
      hasMessages: false,
    };
  }

  /**
   * Make the given session active. Loads its transcript into memory and
   * persists the active pointer. Returns transcript + ledger so callers
   * (preload IPC) can hydrate the renderer in one round trip.
   */
  resumeSession(sessionId: string): { session: ChatroomSessionSummary; messages: ChatroomMessage[]; taskLedger: TaskLedgerItem[] } {
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      // Switching sessions while a round is in flight could leak events into
      // the new session. Stop any active run; do NOT clear the previous
      // session's persisted transcript.
      this.stopAll();
      this.cancelPendingLedgerPersist();
    }

    const record = this.sessionStore.load(sessionId);
    const state: SessionState = {
      sessionId: record.sessionId,
      messages: [...record.transcript.messages],
      lastLedger: Array.isArray(record.transcript.taskLedger) ? [...record.transcript.taskLedger] : [],
      disabledMindIds: new Set(
        Array.isArray(record.transcript.disabledMindIds)
          ? record.transcript.disabledMindIds.filter((id): id is string => typeof id === 'string')
          : [],
      ),
    };
    this.sessionStates.set(sessionId, state);
    this.activeSessionId = sessionId;
    this.sessionStore.setActiveSessionId(sessionId);
    this.emitStateChanged();

    return {
      session: this.summarize(sessionId, record.title, record.createdAt, record.updatedAt, state),
      messages: [...state.messages],
      taskLedger: [...state.lastLedger],
    };
  }

  renameSession(sessionId: string, title: string): ChatroomSessionSummary[] {
    this.sessionStore.rename(sessionId, title);
    return this.sessionStore.list();
  }

  /**
   * Delete a session. If it is the active one, clears the active pointer
   * (callers can resume another or land on the empty-state picker).
   */
  deleteSession(sessionId: string): ChatroomSessionSummary[] {
    if (this.activeSessionId === sessionId) {
      this.stopAll();
      this.cancelPendingLedgerPersist();
      this.sessionStates.delete(sessionId);
      this.activeSessionId = null;
    }
    this.sessionStore.delete(sessionId);
    return this.sessionStore.list();
  }

  // -------------------------------------------------------------------------
  // Public API (single-session compatibility surface)
  //
  // These operate on the active session. If none is set, `ensureActiveState`
  // auto-creates a fresh "New chatroom" session so legacy callers (and the
  // existing test suite) continue to work without changing every call site.
  // -------------------------------------------------------------------------

  async broadcast(userMessage: string, suppliedRoundId?: string, selectedModel?: string): Promise<void> {
    const state = this.ensureActiveState();

    // Cancel any in-flight agents from previous round
    this.stopAll();

    // Drop any pending debounced ledger write -- we're starting a new round
    // and will write the cleared ledger below.
    this.cancelPendingLedgerPersist();

    // Clear stale task ledger from previous orchestration round
    // (persisted alongside user message below)
    state.lastLedger = [];

    const roundId = this.resolveRoundId(state, suppliedRoundId);

    // Snapshot participants (only ready minds) and apply the user-managed
    // disabled set. Snapshotted once at the top of the round so a toggle
    // mid-round does not affect the in-flight broadcast.
    const allMinds = this.sessionFactory.listMinds();
    const readyMinds = allMinds.filter((m) => m.status === 'ready');
    // Minds that exist but are not ready right now (loading, reattaching,
    // unloading, error). The user expects them to participate, so warn
    // explicitly when at least one is skipped.
    const notYetReady = allMinds.filter((m) => m.status !== 'ready' && !state.disabledMindIds.has(m.mindId));
    const participants = readyMinds.filter((m) => !state.disabledMindIds.has(m.mindId));
    if (selectedModel && this.sessionFactory.setMindModel) {
      await Promise.all(participants.map((participant) => this.sessionFactory.setMindModel?.(participant.mindId, selectedModel)));
    }

    // Create and persist user message
    const userMsg = this.createUserMessage(userMessage, roundId);
    state.messages.push(userMsg);
    this.persist(state);

    // No enabled participants -- emit and persist a system assistant message
    // so the user sees explicit feedback rather than a silent no-op.
    if (participants.length === 0) {
      this.emitSystemMessage(
        state,
        roundId,
        readyMinds.length === 0
          ? 'No agents are loaded. Add an agent to start chatting.'
          : 'No agents are enabled. Click an agent at the top to re-enable it.',
      );
      return;
    }

    // Some enabled minds aren't ready yet (still loading / reattaching after
    // a restart, etc.). They'll be silently skipped by the broadcast; warn so
    // the user understands why only some participants responded.
    if (notYetReady.length > 0) {
      const names = notYetReady.map((m) => m.identity.name).join(', ');
      const verb = notYetReady.length === 1 ? 'is' : 'are';
      this.emitSystemMessage(
        state,
        roundId,
        `${names} ${verb} still loading and did not take this turn. Try again in a moment.`,
      );
    }

    // Validate orchestration prerequisites against the *enabled* set.
    // Without this, disabling the moderator/manager produces a confusing
    // silent no-op or partial behavior inside the strategy.
    const orchestrationError = this.validateOrchestrationPrerequisites(participants);
    if (orchestrationError) {
      this.emitSystemMessage(state, roundId, orchestrationError);
      return;
    }

    log.info(`broadcast mode="${this.orchestrationMode}" participants=${participants.length} disabled=${state.disabledMindIds.size} handoffConfig=${JSON.stringify(this.handoffConfig)} magneticConfig=${JSON.stringify(this.magneticConfig)}`);

    // Warm session pool -- pre-create sessions for all participants in parallel
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
        product: this.buildProductHooks(state, roundId),
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
    const state = this.activeStateOrNull();
    return state ? [...state.messages] : [];
  }

  getTaskLedger(): TaskLedgerItem[] {
    const state = this.activeStateOrNull();
    return state ? [...state.lastLedger] : [];
  }

  /**
   * Toggle a mind's chatroom participation. Persists synchronously and
   * emits `chatroom:state-changed` so any other windows update too.
   * No-op if the requested state is already the current one. Scoped to
   * the active session: each session has its own disabled-mind set.
   */
  setMindEnabled(mindId: string, enabled: boolean): void {
    const state = this.ensureActiveState();
    const wasDisabled = state.disabledMindIds.has(mindId);
    const wantDisabled = !enabled;
    if (wasDisabled === wantDisabled) return;
    if (wantDisabled) {
      state.disabledMindIds.add(mindId);
    } else {
      state.disabledMindIds.delete(mindId);
    }
    this.persist(state);
    this.emitStateChanged();
  }

  /** Snapshot of currently disabled mind IDs for the active session. */
  getDisabledMindIds(): string[] {
    const state = this.activeStateOrNull();
    return state ? [...state.disabledMindIds] : [];
  }

  /**
   * Wipe the active session's transcript (messages + ledger). Does NOT
   * delete the session itself -- use {@link deleteSession} for that.
   */
  async clearHistory(): Promise<void> {
    this.cancelPendingLedgerPersist();
    const state = this.activeStateOrNull();
    if (state) {
      state.messages = [];
      state.lastLedger = [];
      this.persist(state);
    }

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
  private buildProductHooks(state: SessionState, roundId: string): ProductHooks {
    return {
      buildBasePrompt: (msg, parts, forMind) =>
        this.buildPrompt(state, msg, parts, roundId, forMind),
      emitEvent: (event) => this.emit('chatroom:event', event),
      persistMessage: (message) => {
        state.messages.push(message);
        this.persist(state);
      },
      getHistory: () => [...state.messages],
    };
  }

  /** Emit a system-level orchestration error event. */
  private emitOrchestrationError(roundId: string, err: unknown): void {
    this.emit('chatroom:event', {
      mindId: 'system',
      mindName: 'System',
      messageId: randomUUID(),
      roundId,
      event: { type: 'error', message: `Orchestration error: ${getErrorMessage(err)}` },
    } satisfies ChatroomStreamEvent);
  }

  /**
   * Persist a system assistant message in the transcript and stream it
   * to the renderer in one shot. Used for "no enabled participants" and
   * for orchestration prerequisite failures so the user sees explicit
   * feedback instead of a silent dropped round.
   */
  private emitSystemMessage(state: SessionState, roundId: string, text: string): void {
    const messageId = randomUUID();
    const msg: ChatroomMessage = {
      id: messageId,
      role: 'assistant',
      blocks: [{ type: 'text', content: text }],
      timestamp: Date.now(),
      sender: { mindId: 'system', name: 'System' },
      roundId,
    };
    state.messages.push(msg);
    this.persist(state);
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
        return 'Manager-led orchestration needs at least one worker enabled in addition to the manager.';
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

  private resolveRoundId(state: SessionState, supplied: string | undefined): string {
    if (supplied === undefined) return randomUUID();
    if (state.messages.some((m) => m.roundId === supplied)) {
      log.warn(`broadcast received duplicate roundId "${supplied}"; generating a fresh id`);
      return randomUUID();
    }
    return supplied;
  }

  // -------------------------------------------------------------------------
  // Active-session bookkeeping
  // -------------------------------------------------------------------------

  /**
   * Return the active session's state, auto-creating + auto-activating a
   * fresh session if no session is currently active. Used by legacy
   * single-session entry points (broadcast, setMindEnabled) so prior
   * call sites keep working without explicit session management.
   */
  private ensureActiveState(): SessionState {
    if (this.activeSessionId) {
      const state = this.sessionStates.get(this.activeSessionId);
      if (state) return state;
    }
    const record = this.sessionStore.create({ title: DEFAULT_AUTOCREATE_TITLE });
    const state: SessionState = {
      sessionId: record.sessionId,
      messages: [],
      lastLedger: [],
      disabledMindIds: new Set(),
    };
    this.sessionStates.set(record.sessionId, state);
    this.activeSessionId = record.sessionId;
    this.sessionStore.setActiveSessionId(record.sessionId);
    return state;
  }

  /** Active session state if one exists; null otherwise. Read-only path. */
  private activeStateOrNull(): SessionState | null {
    if (!this.activeSessionId) return null;
    return this.sessionStates.get(this.activeSessionId) ?? null;
  }

  /**
   * On startup, if the store has an active-pointer (e.g. the legacy
   * migration set one, or the user had a session active before the last
   * shutdown), eagerly load it so legacy IPC handlers see a non-empty
   * history immediately.
   */
  private restoreActiveSessionIfAny(): void {
    const id = this.sessionStore.getActiveSessionId();
    if (!id) return;
    try {
      const record = this.sessionStore.load(id);
      this.sessionStates.set(id, {
        sessionId: id,
        messages: [...record.transcript.messages],
        lastLedger: Array.isArray(record.transcript.taskLedger) ? [...record.transcript.taskLedger] : [],
        disabledMindIds: new Set(
          Array.isArray(record.transcript.disabledMindIds)
            ? record.transcript.disabledMindIds.filter((s): s is string => typeof s === 'string')
            : [],
        ),
      });
      this.activeSessionId = id;
    } catch {
      // Stale pointer; ChatroomSessionStore.getActiveSessionId will self-heal
      // on next call, so just leave activeSessionId null here.
    }
  }

  private summarize(
    sessionId: string,
    title: string,
    createdAt: string,
    updatedAt: string,
    state: SessionState,
  ): ChatroomSessionSummary {
    return {
      sessionId,
      title,
      createdAt,
      updatedAt,
      active: this.activeSessionId === sessionId,
      hasMessages: state.messages.some((m) => m.role === 'user' || m.role === 'assistant'),
    };
  }

  // -------------------------------------------------------------------------
  // Context prompt building
  // -------------------------------------------------------------------------

  private buildPrompt(
    state: SessionState,
    currentMessage: string,
    participants: MindContext[],
    roundId: string,
    forMind?: MindContext,
  ): string {
    void roundId;
    const historyRounds = this.getLastNRounds(state, 2);
    const participantNames = participants.map((p) => p.identity.name).join(', ');

    // Identity reminder so each agent stays in character
    const identityPrefix = forMind
      ? `<identity>You are ${escapeXml(forMind.identity.name)}. Stay in character. Respond as this persona would -- use their voice, perspective, and expertise. Do not break character or sound like the other participants.</identity>\n\n`
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

  private getLastNRounds(state: SessionState, n: number): ChatroomMessage[] {
    const seen = new Set<string>();
    const roundIds: string[] = [];
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const rid = state.messages[i].roundId;
      if (!seen.has(rid)) {
        seen.add(rid);
        roundIds.unshift(rid);
      }
    }

    // Exclude the current round (it's being built now -- its user msg is already in state.messages)
    // The last roundId is the current round, so take n rounds before it
    const currentRoundId = roundIds[roundIds.length - 1];
    const targetRoundIds = new Set(
      roundIds.filter((r) => r !== currentRoundId).slice(-n),
    );

    return state.messages.filter((m) => targetRoundIds.has(m.roundId));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persist(state: SessionState): void {
    try {
      const trimmed = state.messages.slice(-MAX_MESSAGES);
      state.messages = trimmed;
      const transcript: ChatroomTranscript = {
        version: 1,
        messages: trimmed,
        taskLedger: state.lastLedger,
        disabledMindIds: [...state.disabledMindIds],
      };
      this.sessionStore.save(state.sessionId, transcript);
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
      const state = this.activeStateOrNull();
      if (state) this.persist(state);
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

    // Housekeeping: drop the mind from every loaded session's disabled
    // set so a re-added mind with the same id starts enabled, and the
    // persisted sets don't accumulate stale ids. Persist + broadcast only
    // if the active session's set actually changed.
    let activeChanged = false;
    for (const state of this.sessionStates.values()) {
      if (state.disabledMindIds.delete(mindId)) {
        this.persist(state);
        if (state.sessionId === this.activeSessionId) {
          activeChanged = true;
        }
      }
    }
    if (activeChanged) this.emitStateChanged();
  }
}
