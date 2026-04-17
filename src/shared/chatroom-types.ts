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

// ---------------------------------------------------------------------------
// Orchestration events — emitted alongside normal ChatroomStreamEvents
// ---------------------------------------------------------------------------

export type OrchestrationEventType =
  | 'orchestration:turn-start'
  | 'orchestration:moderator-decision'
  | 'orchestration:convergence'
  | 'orchestration:synthesis';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  data: Record<string, unknown>;
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
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  setOrchestration: (mode: OrchestrationMode, config?: GroupChatConfig) => Promise<void>;
  getOrchestration: () => Promise<{ mode: OrchestrationMode; config: GroupChatConfig | null }>;
  onEvent: (callback: (event: ChatroomStreamEvent) => void) => () => void;
}
