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
  agentName: string | null;
  sessionActive: boolean;
  uptime: number | null;
  error: string | null;
  extensions: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface AppConfig {
  mindPath: string | null;
  theme: 'light' | 'dark' | 'system';
}

export interface LensViewManifest {
  id: string;
  name: string;
  icon: string;
  view: 'form' | 'table' | 'briefing' | 'status-board' | 'list' | 'monitor' | 'detail' | 'timeline' | 'editor';
  source: string;
  schema?: Record<string, unknown>;
  prompt?: string;
  refreshOn?: 'click' | 'interval';
  /** Resolved absolute path to the view.json directory */
  _basePath?: string;
}

export interface ElectronAPI {
  chat: {
    send: (conversationId: string, message: string, messageId: string, model?: string) => Promise<void>;
    stop: (conversationId: string, messageId: string) => Promise<void>;
    newConversation: (conversationId: string) => Promise<void>;
    listModels: () => Promise<ModelInfo[]>;
    onEvent: (callback: (messageId: string, event: ChatEvent) => void) => () => void;
  };
  agent: {
    getStatus: () => Promise<AgentStatus>;
    selectMindDirectory: () => Promise<string | null>;
    setMindPath: (mindPath: string) => Promise<void>;
    onStatusChanged: (callback: (status: AgentStatus) => void) => () => void;
  };
  lens: {
    getViews: () => Promise<LensViewManifest[]>;
    getViewData: (viewId: string) => Promise<Record<string, unknown> | null>;
    refreshView: (viewId: string) => Promise<Record<string, unknown> | null>;
    sendAction: (viewId: string, action: string) => Promise<Record<string, unknown> | null>;
    onViewsChanged: (callback: (views: LensViewManifest[]) => void) => () => void;
  };
  genesis: {
    getDefaultPath: () => Promise<string>;
    pickPath: () => Promise<string | null>;
    create: (config: { name: string; role: string; voice: string; voiceDescription: string; basePath: string }) => Promise<{ success: boolean; mindPath?: string; error?: string }>;
    onProgress: (callback: (progress: { step: string; detail: string }) => void) => () => void;
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
