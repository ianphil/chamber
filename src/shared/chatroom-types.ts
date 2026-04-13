// Shared chatroom types — used by main, preload, and renderer

import type { ChatMessage, ChatEvent, ContentBlock } from './types';

// ---------------------------------------------------------------------------
// Chatroom message — ChatMessage with required sender attribution
// ---------------------------------------------------------------------------

export interface ChatroomMessage extends ChatMessage {
  sender: { mindId: string; name: string };
  roundId: string;
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
  event: ChatEvent;
}

// ---------------------------------------------------------------------------
// Chatroom ElectronAPI surface
// ---------------------------------------------------------------------------

export interface ChatroomAPI {
  send: (message: string, model?: string) => Promise<void>;
  history: () => Promise<ChatroomMessage[]>;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  onEvent: (callback: (event: ChatroomStreamEvent) => void) => () => void;
}
