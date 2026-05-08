import type { A2AIncomingPayload, AgentCard, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent, ListTasksResponse } from './a2a-types';
import type { ChatroomAPI } from './chatroom-types';
export type { A2AIncomingPayload } from './a2a-types';

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

export interface ImageBlock {
  type: 'image';
  name: string;
  mimeType: string;
  /** data URL (data:<mime>;base64,<payload>) for renderer display */
  dataUrl: string;
}

export type ContentBlock = TextBlock | ToolCallBlock | ReasoningBlock | ImageBlock;

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
  | { type: 'reconnecting' }
  | { type: 'done' }
  | { type: 'timeout'; timeoutMs: number }
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
  sender?: { mindId: string; name: string };
}

// ---------------------------------------------------------------------------
// Mind — multi-mind runtime types
// ---------------------------------------------------------------------------

export interface MindIdentity {
  readonly name: string;
  readonly systemMessage: string;
}

export type MindStatus = 'loading' | 'ready' | 'error' | 'unloading';

/** Shared mind context — safe for renderer consumption */
export interface MindContext {
  readonly mindId: string;
  readonly mindPath: string;
  readonly identity: MindIdentity;
  readonly status: MindStatus;
  readonly error?: string;
  selectedModel?: string;
  activeSessionId?: string;
  readonly windowed?: boolean;
}

/** Persisted mind record in config */
export interface MindRecord {
  id: string;
  path: string;
  selectedModel?: string;
  activeSessionId?: string;
  conversations?: ChamberConversationRecord[];
}

export type ChamberConversationKind = 'chat' | 'cron' | 'task';

export interface ChamberConversationRecord {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  kind: ChamberConversationKind;
  hasMessages?: boolean;
}

export interface ConversationSummary {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  kind: ChamberConversationKind;
  active: boolean;
  hasMessages?: boolean;
}

export interface ConversationResumeResult {
  sessionId: string;
  messages: ChatMessage[];
  conversations: ConversationSummary[];
}

export interface MarketplaceRegistry {
  id: string;
  label: string;
  url: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  enabled: boolean;
  isDefault: boolean;
}

export type MarketplaceRegistryActionResult =
  | { success: true; registry: MarketplaceRegistry }
  | { success: false; error: string };

export interface ModelInfo {
  id: string;
  name: string;
}

/** @deprecated Use AppConfigV2 — kept for migration */
export interface AppConfigV1 {
  mindPath: string | null;
  theme: 'light' | 'dark' | 'system';
}

export interface AppConfig {
  version: 2;
  minds: MindRecord[];
  activeMindId: string | null;
  activeLogin: string | null;
  theme: 'light' | 'dark' | 'system';
  marketplaceRegistries?: MarketplaceRegistry[];
  installedTools?: InstalledTool[];
}

interface InstalledToolBase {
  id: string;
  version: string;
  bin: string;
  displayName: string;
  description: string;
  help?: string;
  agentInstructions?: string;
  source: { marketplaceId: string; pluginId: string };
  installedAt: string;
}

/**
 * Persistent record of a CLI tool installed via the marketplace. Records carry
 * the agent-facing description so the system message can advertise tools
 * offline (no marketplace fetch needed at session start).
 */
export type InstalledTool = InstalledNpmGlobalTool | InstalledGitHubReleaseAssetTool;

export interface InstalledNpmGlobalTool extends InstalledToolBase {
  package: string;
  install?: { type: 'npm-global'; package: string; version: string };
}

export interface InstalledGitHubReleaseAssetTool extends InstalledToolBase {
  install: {
    type: 'github-release-asset';
    owner: string;
    repo: string;
    tag: string;
    assetName: string;
    sha256: string;
    platform: string;
    arch: string;
    installedPath: string;
    archive?: GitHubReleaseAssetArchiveType;
    binPath?: string;
  };
}

export type GitHubReleaseAssetArchiveType = 'zip' | 'tar.gz';

export interface GitHubReleaseAssetSelector {
  platform: string;
  arch: string;
  name: string;
  sha256: string;
  archive?: GitHubReleaseAssetArchiveType;
  binPath?: string;
}

export type MarketplaceToolInstall =
  | { type: 'npm-global'; package: string; version: string }
  | {
    type: 'github-release-asset';
    owner: string;
    repo: string;
    tag: string;
    assets: GitHubReleaseAssetSelector[];
  };

export interface MarketplaceToolEntry {
  id: string;
  displayName: string;
  description: string;
  install: MarketplaceToolInstall;
  bin: string;
  help?: string;
  preflight?: string[];
  /** Inline markdown describing how the model should invoke the CLI. Rendered into the system message. */
  agentInstructions?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    plugin: string;
    marketplaceId: string;
    marketplaceLabel: string;
    marketplaceUrl: string;
  };
}

export type ToolInstallStatus = 'installed' | 'available' | 'error';

export interface ToolCatalogEntry extends MarketplaceToolEntry {
  status: ToolInstallStatus;
  installedVersion?: string;
  errorMessage?: string;
}

export type ToolActionResult =
  | { success: true; tool: InstalledTool }
  | { success: false; error: string };

export interface LensViewManifest {
  id: string;
  name: string;
  icon: string;
  view: 'form' | 'table' | 'briefing' | 'status-board' | 'list' | 'monitor' | 'detail' | 'timeline' | 'editor' | 'canvas';
  source: string;
  schema?: Record<string, unknown>;
  prompt?: string;
  refreshOn?: 'click' | 'interval';
  /** Resolved absolute path to the view.json directory */
  _basePath?: string;
}

export interface CanvasLensAction {
  action: string;
  data?: unknown;
  intent?: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Chat attachments (renderer → main → SDK)
// ---------------------------------------------------------------------------

/** A pasted/attached image carried over IPC to ChatService → SDK blob attachment */
export interface ChatImageAttachment {
  name: string;
  mimeType: string;
  /** base64-encoded payload without data URL prefix */
  data: string;
}

export type DesktopUpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  downloadedVersion?: string;
  downloadPercent: number | null;
  checkedAt?: string;
  message: string | null;
  errorContext?: string;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  success: boolean;
  message?: string;
}

export interface ElectronAPI {
  chat: {
    send: (mindId: string, message: string, messageId: string, model?: string, attachments?: ChatImageAttachment[]) => Promise<void>;
    stop: (mindId: string, messageId: string) => Promise<void>;
    newConversation: (mindId: string) => Promise<ConversationResumeResult>;
    listModels: (mindId?: string) => Promise<ModelInfo[]>;
    onEvent: (callback: (mindId: string, messageId: string, event: ChatEvent) => void) => () => void;
  };
  conversationHistory: {
    list: (mindId: string) => Promise<ConversationSummary[]>;
    resume: (mindId: string, sessionId: string) => Promise<ConversationResumeResult>;
    rename: (mindId: string, sessionId: string, title: string) => Promise<ConversationSummary[]>;
    delete: (mindId: string, sessionId: string) => Promise<ConversationResumeResult>;
  };
  mind: {
    add: (mindPath: string) => Promise<MindContext>;
    remove: (mindId: string) => Promise<void>;
    list: () => Promise<MindContext[]>;
    setActive: (mindId: string) => Promise<void>;
    setModel: (mindId: string, model: string | null) => Promise<MindContext | null>;
    selectDirectory: () => Promise<string | null>;
    openWindow: (mindId: string) => Promise<void>;
    onMindChanged: (callback: (minds: MindContext[]) => void) => () => void;
  };
  lens: {
    getViews: (mindId?: string) => Promise<LensViewManifest[]>;
    getViewData: (viewId: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    refreshView: (viewId: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    sendAction: (viewId: string, action: string, mindId?: string) => Promise<Record<string, unknown> | null>;
    getCanvasUrl: (viewId: string, mindId?: string) => Promise<string | null>;
    onViewsChanged: (callback: (views: LensViewManifest[], mindId?: string) => void) => () => void;
  };
  auth: {
    getStatus: () => Promise<{ authenticated: boolean; login?: string }>;
    listAccounts: () => Promise<Array<{ login: string }>>;
    startLogin: () => Promise<{ success: boolean; login?: string; error?: string }>;
    cancelLogin?: () => Promise<void>;
    switchAccount: (login: string) => Promise<void>;
    logout: () => Promise<void>;
    onProgress: (callback: (progress: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => void) => () => void;
    onAccountSwitchStarted: (callback: (data: { login: string }) => void) => () => void;
    onAccountSwitched: (callback: (data: { login: string }) => void) => () => void;
    onLoggedOut: (callback: () => void) => () => void;
  };
  genesis: {
    getDefaultPath: () => Promise<string>;
    pickPath: () => Promise<string | null>;
    listTemplates: () => Promise<GenesisMindTemplate[]>;
    create: (config: { name: string; role: string; voice: string; voiceDescription: string; basePath: string }) => Promise<{ success: boolean; mindId?: string; mindPath?: string; error?: string }>;
    createFromTemplate: (request: { templateId: string; marketplaceId?: string; basePath: string }) => Promise<{ success: boolean; mindId?: string; mindPath?: string; error?: string }>;
    onProgress: (callback: (progress: { step: string; detail: string }) => void) => () => void;
  };
  marketplace: {
    listGenesisRegistries: () => Promise<MarketplaceRegistry[]>;
    addGenesisRegistry: (url: string) => Promise<MarketplaceRegistryActionResult>;
    refreshGenesisRegistry: (id: string) => Promise<MarketplaceRegistryActionResult>;
    setGenesisRegistryEnabled: (id: string, enabled: boolean) => Promise<MarketplaceRegistryActionResult>;
    removeGenesisRegistry: (id: string) => Promise<MarketplaceRegistryActionResult>;
  };
  tools: {
    list: () => Promise<ToolCatalogEntry[]>;
    install: (toolId: string, marketplaceId?: string) => Promise<ToolActionResult>;
    uninstall: (toolId: string) => Promise<{ success: boolean; error?: string }>;
  };
  chatroom: ChatroomAPI;
  updater: {
    getState: () => Promise<DesktopUpdateState>;
    check: () => Promise<DesktopUpdateActionResult>;
    download: () => Promise<DesktopUpdateActionResult>;
    installAndRestart: () => Promise<DesktopUpdateActionResult>;
    onStateChanged: (callback: (state: DesktopUpdateState) => void) => () => void;
  };
  a2a: {
    onIncoming:(callback: (payload: A2AIncomingPayload) => void) => () => void;
    listAgents: () => Promise<AgentCard[]>;
    onTaskStatusUpdate: (callback: (payload: TaskStatusUpdateEvent & { targetMindId: string }) => void) => () => void;
    onTaskArtifactUpdate: (callback: (payload: TaskArtifactUpdateEvent & { targetMindId: string }) => void) => () => void;
    getTask: (taskId: string, historyLength?: number) => Promise<Task | null>;
    listTasks: (filter?: { contextId?: string; status?: string }) => Promise<ListTasksResponse>;
    cancelTask: (taskId: string) => Promise<Task | { error: string }>;
  };
  e2e?: {
    emitA2AIncoming: (payload: A2AIncomingPayload) => Promise<void>;
    emitAuthProgress: (payload: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => Promise<void>;
    completeLoginStub: (payload: { success?: boolean; login?: string }) => Promise<void>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
}

export interface GenesisMindTemplate {
  id: string;
  displayName: string;
  description: string;
  role: string;
  voice: string;
  templateVersion: string;
  agent: string;
  requiredFiles: string[];
  source: {
    owner: string;
    repo: string;
    ref: string;
    plugin: string;
    manifestPath: string;
    rootPath: string;
    marketplaceId?: string;
    marketplaceLabel?: string;
    marketplaceUrl?: string;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
