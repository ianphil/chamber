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
  A2AInboundApprovalRequest,
  A2ARelayConnectRequest,
  A2ARelayStatus,
  AgentCard,
  ListTasksResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from './a2a-types';
import type { ChatroomAPI } from './chatroom-types';
import type { AppFeatureFlags } from './feature-flags';
import type { CancelOutcome, LedgerRecord, LedgerStatus } from './ledger';
import type {
  TranscriptionEvent,
  VoiceDictationConfig,
  VoiceDownloadModelOptions,
  VoiceMicTestResult,
  VoiceModelStatus,
  VoicePermissionState,
} from './voice-types';
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
  ChatReplayEvent,
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
  StartupProgressEvent,
  ToolActionResult,
  ToolCatalogEntry,
  UserProfile,
  UserProfileImportResult,
  UserProfileSaveRequest,
} from './types';
import type { SkillManifest } from './skill-types';

export interface ElectronAPI {
  chat: {
    send: (mindId: string, message: string, messageId: string, model?: string, attachments?: ChatImageAttachment[]) => Promise<void>;
    stop: (mindId: string, messageId: string) => Promise<void>;
    newConversation: (mindId: string) => Promise<ConversationResumeResult>;
    listModels: (mindId?: string) => Promise<ModelInfo[]>;
    getEventSequence: () => Promise<number>;
    replayEvents: (afterSequence: number) => Promise<ChatReplayEvent[]>;
    onEvent: (callback: (mindId: string, messageId: string, event: ChatEvent, sequence?: number) => void) => () => void;
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
  tasks: {
    list: (mindId: string) => Promise<LedgerRecord[]>;
    get: (mindId: string, ledgerId: string) => Promise<LedgerRecord | { error: string }>;
    cancel: (mindId: string, ledgerId: string) => Promise<CancelOutcome>;
    audit: (mindId: string) => Promise<{
      counts: Record<LedgerStatus, number>;
      findings: Array<{ type: 'stale-running' | 'missing-cleanup' | 'delivery-failed'; ledgerId: string }>;
    }>;
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
    listPendingApprovals: () => Promise<A2AInboundApprovalRequest[]>;
    approvePendingRequest: (id: string, digest: string) => Promise<A2AInboundApprovalRequest>;
    declinePendingRequest: (id: string, digest: string) => Promise<A2AInboundApprovalRequest>;
    onApprovalStateChanged: (callback: (requests: A2AInboundApprovalRequest[]) => void) => () => void;
    onApprovalReviewRequested: (callback: (id: string) => void) => () => void;
  };
  e2e?: {
    emitA2AIncoming: (payload: A2AIncomingPayload) => Promise<void>;
    emitAuthProgress: (payload: { step: string; userCode?: string; verificationUri?: string; login?: string; error?: string }) => Promise<void>;
    completeLoginStub: (payload: { success?: boolean; login?: string }) => Promise<void>;
    voice?: {
      setFakeProvider: () => Promise<void>;
      emitTranscript: (payload?: E2EVoiceTranscriptPayload) => Promise<void>;
      setPermissionState: (state: VoicePermissionState | null) => Promise<void>;
      setModelStatus: (status: VoiceModelStatus | null) => Promise<void>;
      getSessionState: () => Promise<E2EVoiceSessionState>;
    };
  };
  byoLlm: {
    get: () => Promise<ByoLlmConfig | null>;
    save: (config: ByoLlmConfig) => Promise<ByoLlmSaveResult>;
    disable: () => Promise<ByoLlmSaveResult>;
    probe: (config: ByoLlmConfig) => Promise<ByoLlmProbeResult>;
    restartAgents: () => Promise<{ success: boolean; restartedCount: number; error?: string }>;
    onChanged: (callback: (config: ByoLlmConfig | null) => void) => () => void;
  };
  voice: {
    getConfig: () => Promise<VoiceDictationConfig | null>;
    saveConfig: (config: VoiceDictationConfig) => Promise<void>;
    onConfigChanged: (callback: (config: VoiceDictationConfig | null) => void) => () => void;
    getPermissionState: () => Promise<VoicePermissionState>;
    openMicPreferences: () => Promise<void>;
    getModelStatus: (modelId: string) => Promise<VoiceModelStatus>;
    downloadModel: (modelId: string, options?: VoiceDownloadModelOptions) => Promise<void>;
    cancelDownload: (modelId: string) => Promise<void>;
    startSession: (payload: VoiceStartSessionPayload) => Promise<void>;
    appendAudio: (payload: VoiceAppendAudioPayload) => Promise<void>;
    endSession: (payload: VoiceEndSessionPayload) => Promise<void>;
    testMic: () => Promise<VoiceMicTestResult>;
    onModelProgress: (callback: (status: VoiceModelStatus) => void) => () => void;
    onTranscript: (callback: (event: TranscriptionEvent) => void) => () => void;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  app: {
    getFeatureFlags: () => Promise<AppFeatureFlags>;
    /**
     * Subscribe to per-step app-startup progress events while the main
     * process restores minds from config. Drives the boot-screen activity
     * log (#56). Returns an unsubscribe function — call it on unmount.
     */
    onStartupProgress: (callback: (event: StartupProgressEvent) => void) => () => void;
  };
  skills: {
    /**
     * Lists self-declared metadata for skill directories currently on disk.
     * This does not attest managed provenance, integrity, or lifecycle state.
     */
    listForMind: (mindId: string) => Promise<SkillManifest[]>;
  };
}

export interface VoiceStartSessionPayload {
  readonly sessionId: string;
  readonly deviceId?: string | null;
  readonly modelId?: string;
}

export interface VoiceAppendAudioPayload {
  readonly sessionId: string;
  readonly chunk: Uint8Array;
}

export interface VoiceEndSessionPayload {
  readonly sessionId: string;
}

export interface E2EVoiceTranscriptPayload {
  readonly type?: TranscriptionEvent['type'];
  readonly text?: string;
  readonly message?: string;
}

export interface E2EVoiceSessionState {
  readonly activeSessionId: string | null;
  readonly startedCount: number;
  readonly endedCount: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
