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
// Chatroom ElectronAPI surface
// ---------------------------------------------------------------------------

export interface ChatroomAPI {
  send: (message: string, model?: string) => Promise<void>;
  history: () => Promise<ChatroomMessage[]>;
  taskLedger: () => Promise<TaskLedgerItem[]>;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  setOrchestration: (mode: OrchestrationMode, config?: GroupChatConfig | HandoffConfig | MagenticConfig) => Promise<void>;
  getOrchestration: () => Promise<{ mode: OrchestrationMode; config: GroupChatConfig | HandoffConfig | MagenticConfig | null }>;
  onEvent: (callback: (event: ChatroomStreamEvent) => void) => () => void;
}
