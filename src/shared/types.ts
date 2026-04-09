// Shared types across main, preload, and renderer processes

// ---------------------------------------------------------------------------
// Content blocks — ordered units within an assistant message
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  sdkMessageId?: string;
  content: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  arguments?: Record<string, unknown>;
  output?: string;
  error?: string;
  parentToolCallId?: string;
}

export interface ReasoningBlock {
  type: 'reasoning';
  reasoningId: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolCallBlock | ReasoningBlock;

// ---------------------------------------------------------------------------
// Chat events — single sequenced IPC channel
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { type: 'chunk'; sdkMessageId?: string; content: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args?: Record<string, unknown>; parentToolCallId?: string }
  | { type: 'tool_progress'; toolCallId: string; message: string }
  | { type: 'tool_output'; toolCallId: string; output: string }
  | { type: 'tool_done'; toolCallId: string; success: boolean; result?: string; error?: string }
  | { type: 'reasoning'; reasoningId: string; content: string }
  | { type: 'message_final'; sdkMessageId: string; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Chat message
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
}

export interface AgentStatus {
  connected: boolean;
  mindPath: string | null;
  sessionActive: boolean;
  uptime: number | null;
  error: string | null;
  extensions: string[];
}

export interface AppConfig {
  mindPath: string | null;
  theme: 'light' | 'dark' | 'system';
}

export interface ElectronAPI {
  chat: {
    send: (conversationId: string, message: string, messageId: string) => Promise<void>;
    stop: (conversationId: string, messageId: string) => Promise<void>;
    newConversation: (conversationId: string) => Promise<void>;
    onEvent: (callback: (messageId: string, event: ChatEvent) => void) => () => void;
  };
  agent: {
    getStatus: () => Promise<AgentStatus>;
    selectMindDirectory: () => Promise<string | null>;
    setMindPath: (mindPath: string) => Promise<void>;
    onStatusChanged: (callback: (status: AgentStatus) => void) => () => void;
  };
  config: {
    load: () => Promise<AppConfig>;
    save: (config: AppConfig) => Promise<void>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
