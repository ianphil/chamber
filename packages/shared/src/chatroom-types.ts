// Shared chatroom types — used by main, preload, and renderer

import type { ChatMessage, ChatEvent } from './types';

// ---------------------------------------------------------------------------
// Orchestration patterns — ordered by complexity
// ---------------------------------------------------------------------------

export type OrchestrationMode =
  | 'concurrent'    // Today's broadcast (all agents respond in parallel)
  | 'sequential'    // Round-robin (agents take turns in order)
  | 'handoff'       // One agent delegates to the next (stub)
  | 'group-chat'    // Moderated — a moderator mind picks next speaker
  | 'magentic';     // Autonomous multi-agent (stub)

/** Configuration for group-chat orchestration */
export interface GroupChatConfig {
  moderatorMindId: string;      // Which mind acts as moderator
  maxTurns: number;             // Safety cap on total individual turns (default 10)
  minRounds: number;            // Minimum complete rounds where every participant speaks (default 1)
  maxSpeakerRepeats: number;    // Max times one speaker can go consecutively (default 3)
}

/** Configuration for handoff orchestration */
export interface HandoffConfig {
  initialMindId?: string;       // Which mind starts (defaults to first participant)
  maxHandoffHops: number;       // Safety cap on total handoffs (default 5)
}

/** Reason a handoff orchestration terminated */
export type HandoffTerminationReason =
  | 'DONE'           // Agent signalled task complete
  | 'MAX_HOPS'       // Hit maxHandoffHops limit
  | 'LOOP_DETECTED'  // Cycle detected (A→B→A)
  | 'ERROR'          // Unrecoverable error
  | 'CANCELLED';     // User/system abort

/** Configuration for magentic (manager-driven) orchestration */
export interface MagenticConfig {
  managerMindId: string;        // Which mind acts as the manager
  maxSteps: number;             // Safety cap on total steps (default 10)
  allowedMindIds?: string[];    // Allowlist of agent mindIds (defaults to all participants)
}

/** A single task item in the magentic task ledger */
export interface TaskLedgerItem {
  id: string;
  description: string;
  assignee?: string;            // mindId of assigned agent
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  result?: string;
}

// ---------------------------------------------------------------------------
// Approval gate — governance for side-effect tools
// ---------------------------------------------------------------------------

/** Risk level for side-effect tool invocation */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Payload emitted when a side-effect tool requires approval */
export interface ApprovalRequest {
  correlationId: string;
  actorId: string;
  toolName: string;
  parameters: Record<string, unknown>;  // Redacted
  reason: string;
  riskLevel: RiskLevel;
  timestamp: number;
}

/** Decision from an approver */
export interface ApprovalDecision {
  correlationId: string;
  approved: boolean;
  decidedBy: string;
  timestamp: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Orchestration events — emitted alongside normal ChatroomStreamEvents
// ---------------------------------------------------------------------------

export type OrchestrationEventType =
  | 'orchestration:turn-start'
  | 'orchestration:moderator-decision'
  | 'orchestration:convergence'
  | 'orchestration:synthesis'
  | 'orchestration:handoff'
  | 'orchestration:handoff-terminated'
  | 'orchestration:magentic-terminated'
  | 'orchestration:task-ledger-update'
  | 'orchestration:manager-plan'
  | 'orchestration:approval-requested'
  | 'orchestration:approval-decided'
  | 'orchestration:metrics';

/** Discriminated union of orchestration events — enables type-safe switch in reducers */
export type OrchestrationEvent =
  | { type: 'orchestration:turn-start'; data: { speaker: string; speakerMindId: string } & Record<string, unknown> }
  | { type: 'orchestration:moderator-decision'; data: Record<string, unknown> }
  | { type: 'orchestration:convergence'; data: Record<string, unknown> }
  | { type: 'orchestration:synthesis'; data: Record<string, unknown> }
  | { type: 'orchestration:handoff'; data: { from: string; fromMindId: string; to: string; toMindId: string; reason: string } & Record<string, unknown> }
  | { type: 'orchestration:handoff-terminated'; data: Record<string, unknown> }
  | { type: 'orchestration:magentic-terminated'; data: Record<string, unknown> }
  | { type: 'orchestration:task-ledger-update'; data: Record<string, unknown> }
  | { type: 'orchestration:manager-plan'; data: Record<string, unknown> }
  | { type: 'orchestration:approval-requested'; data: Record<string, unknown> }
  | { type: 'orchestration:approval-decided'; data: Record<string, unknown> }
  | { type: 'orchestration:metrics'; data: { elapsedMs: number; totalTasks: number; completedTasks: number; failedTasks: number; agentsUsed: number; orchestrationMode: string } };

/** Type guard: narrows ChatEvent | OrchestrationEvent to OrchestrationEvent */
export function isOrchestrationEvent(
  event: ChatEvent | OrchestrationEvent,
): event is OrchestrationEvent {
  return event.type.startsWith('orchestration:');
}

// ---------------------------------------------------------------------------
// Chatroom message — ChatMessage with required sender attribution
// ---------------------------------------------------------------------------

export interface ChatroomMessage extends ChatMessage {
  sender: { mindId: string; name: string };
  roundId: string;
  orchestrationMode?: OrchestrationMode;
}

// ---------------------------------------------------------------------------
// Chatroom persistence — JSON file shape
// ---------------------------------------------------------------------------

export interface ChatroomTranscript {
  version: 1;
  messages: ChatroomMessage[];
  taskLedger?: TaskLedgerItem[];
  /**
   * Mind IDs the user has manually disabled in the chatroom. Disabled
   * minds are excluded from the participant snapshot taken at the start
   * of each round but otherwise stay loaded. Default: empty.
   */
  disabledMindIds?: string[];
}

// ---------------------------------------------------------------------------
// Chatroom sessions — named, persistent multi-agent transcripts
// ---------------------------------------------------------------------------

/**
 * A single named chatroom session: title + persistence id + audit timestamps.
 * Mirrors the lightweight ConversationSummary used for single-mind chat
 * history; the full transcript lives in `ChatroomSessionRecord`.
 */
export interface ChatroomSessionSummary {
  sessionId: string;
  title: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp; bumped on every persist. */
  updatedAt: string;
  /** True for the session currently surfaced in the chatroom panel. */
  active: boolean;
  /** True once at least one user message has been recorded. */
  hasMessages: boolean;
}

/**
 * On-disk shape for a single chatroom session. Stored at
 * `<userData>/chatroom-sessions/<sessionId>.json` (one file per session).
 *
 * Wraps the existing ChatroomTranscript shape with id/title/timestamps so
 * loading or migrating a session reuses the same transcript code path.
 */
export interface ChatroomSessionRecord {
  version: 1;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  transcript: ChatroomTranscript;
}

// ---------------------------------------------------------------------------
// Chatroom IPC events
// ---------------------------------------------------------------------------

/** Streaming event from one agent in the chatroom */
export interface ChatroomStreamEvent {
  mindId: string;
  mindName: string;
  messageId: string;
  roundId: string;
  event: ChatEvent | OrchestrationEvent;
}

// ---------------------------------------------------------------------------
// Chatroom state-change event
// ---------------------------------------------------------------------------

/** Authoritative state delta emitted when chatroom preferences change. */
export interface ChatroomStateChange {
  /** Currently disabled mind IDs. Always sent in full (not a delta). */
  disabledMindIds: string[];
}

// ---------------------------------------------------------------------------
// Chatroom ElectronAPI surface
// ---------------------------------------------------------------------------

export interface ChatroomAPI {
  send: (message: string, model?: string, roundId?: string) => Promise<void>;
  history: () => Promise<ChatroomMessage[]>;
  taskLedger: () => Promise<TaskLedgerItem[]>;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  setOrchestration: (mode: OrchestrationMode, config?: GroupChatConfig | HandoffConfig | MagenticConfig) => Promise<void>;
  getOrchestration: () => Promise<{ mode: OrchestrationMode; config: GroupChatConfig | HandoffConfig | MagenticConfig | null }>;
  onEvent: (callback: (event: ChatroomStreamEvent) => void) => () => void;
  setMindEnabled: (mindId: string, enabled: boolean) => Promise<void>;
  getDisabledMindIds: () => Promise<string[]>;
  onStateChanged: (callback: (state: ChatroomStateChange) => void) => () => void;

  // ---------------------------------------------------------------------
  // Sessions
  //
  // Each session is a named, persisted chatroom transcript. The single-
  // session methods above (send/history/clear/...) operate on the
  // currently active session, set via `resumeSession`. `clear` only wipes
  // the active session's transcript; use `deleteSession` to remove a
  // session entirely.
  // ---------------------------------------------------------------------
  listSessions: () => Promise<ChatroomSessionSummary[]>;
  createSession: (title?: string) => Promise<ChatroomSessionSummary>;
  resumeSession: (sessionId: string) => Promise<{
    session: ChatroomSessionSummary;
    messages: ChatroomMessage[];
    taskLedger: TaskLedgerItem[];
  }>;
  renameSession: (sessionId: string, title: string) => Promise<ChatroomSessionSummary[]>;
  deleteSession: (sessionId: string) => Promise<ChatroomSessionSummary[]>;
}
