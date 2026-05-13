/**
 * Renderer-facing API surface that the desktop preload exposes via
 * `contextBridge.exposeInMainWorld('electronAPI', ...)`. This is the single
 * type contract between main and renderer; preload implements it, the
 * renderer consumes it via `window.electronAPI`.
 *
 * Channel name string literals come from `./ipc-channels`; payload types
 * live alongside the relevant feature ones (`./types`, `./chatroom-types`,
 * `./a2a-types`).
 */
import type {
  A2AIncomingPayload,
  A2ARelayConnectRequest,
  A2ARelayStatus,
  AgentCard,
  ListTasksResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from './a2a-types';
import type { ChatroomAPI } from './chatroom-types';
import type {
  AgentProfile,
  AgentProfileActionResult,
  AgentProfileAvatarPickResult,
  AgentProfileAvatarSaveRequest,
  AgentProfileSaveRequest,
  AgentProfileSaveResult,
  ByoLlmConfig,
  ByoLlmProbeResult,
  ByoLlmSaveResult,
  ChatEvent,
  ChatImageAttachment,
  ConversationResumeResult,
  ConversationSummary,
  DesktopUpdateActionResult,
  DesktopUpdateState,
  GenesisMindTemplate,
  LensViewManifest,
  MarketplaceRegistry,
  MarketplaceRegistryActionResult,
  MindContext,
  ModelInfo,
  ToolActionResult,
  ToolCatalogEntry,
  UserProfile,
  UserProfileImportResult,
  UserProfileSaveRequest,
} from './types';

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
  mindProfile: {
    get: (mindId: string) => Promise<AgentProfile>;
    saveFile: (request: AgentProfileSaveRequest) => Promise<AgentProfileSaveResult>;
    pickAvatarImage: () => Promise<AgentProfileAvatarPickResult>;
    saveAvatar: (request: AgentProfileAvatarSaveRequest) => Promise<AgentProfileActionResult>;
    removeAvatar: (mindId: string) => Promise<AgentProfileActionResult>;
    restart: (mindId: string) => Promise<MindContext>;
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
  userProfile: {
    get: () => Promise<UserProfile>;
    save: (request: UserProfileSaveRequest) => Promise<UserProfile>;
    importFromMicrosoft: () => Promise<UserProfileImportResult>;
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
    relayStatus: () => Promise<A2ARelayStatus>;
    relayConnect: (request: A2ARelayConnectRequest) => Promise<A2ARelayStatus>;
    relayDisconnect: () => Promise<A2ARelayStatus>;
    onRelayStateChanged: (callback: (status: A2ARelayStatus) => void) => () => void;
  };
  e2e?: {
    emitA2AIncoming: (payload: A2AIncomingPayload) => Promise<void>;
    emitAuthProgress: (payload: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => Promise<void>;
    completeLoginStub: (payload: { success?: boolean; login?: string }) => Promise<void>;
  };
  byoLlm: {
    get: () => Promise<ByoLlmConfig | null>;
    save: (config: ByoLlmConfig) => Promise<ByoLlmSaveResult>;
    disable: () => Promise<ByoLlmSaveResult>;
    probe: (config: ByoLlmConfig) => Promise<ByoLlmProbeResult>;
    restartAgents: () => Promise<{ success: boolean; restartedCount: number; error?: string }>;
    onChanged: (callback: (config: ByoLlmConfig | null) => void) => () => void;
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
