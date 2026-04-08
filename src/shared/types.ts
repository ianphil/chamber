// Shared types across main, preload, and renderer processes

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface AgentStatus {
  connected: boolean;
  mindPath: string | null;
  sessionActive: boolean;
  uptime: number | null;
  error: string | null;
}

export interface AppConfig {
  mindPath: string | null;
  theme: 'light' | 'dark' | 'system';
}

export interface ElectronAPI {
  chat: {
    send: (conversationId: string, message: string, messageId: string) => Promise<void>;
    stop: (conversationId: string, messageId: string) => Promise<void>;
    onChunk: (callback: (messageId: string, content: string) => void) => () => void;
    onDone: (callback: (messageId: string, fullContent?: string) => void) => () => void;
    onError: (callback: (messageId: string, error: string) => void) => () => void;
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
