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

// Permission request/outcome surfaced inline in the chat stream so users
// can see what the agent asked the SDK to do and how it was resolved.
// Issue #131 checklist 5 — wired from the SDK's `permission.requested` /
// `permission.completed` session events via `mapSdkPermissionRequested`
// and `mapSdkPermissionCompleted`. The block status starts `pending`
// when the request arrives and updates to one of the SDK's
// `PermissionCompletedKind` values when the completion event fires.
export type PermissionRequestKind = 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'custom-tool' | 'memory' | 'hook';

export type PermissionOutcome =
  | 'pending'
  | 'approved'
  | 'approved-for-session'
  | 'approved-for-location'
  | 'denied-by-rules'
  | 'denied-no-approval-rule-and-could-not-request-from-user'
  | 'denied-interactively-by-user'
  | 'denied-by-content-exclusion-policy'
  | 'denied-by-permission-request-hook';

export interface PermissionBlock {
  type: 'permission';
  requestId: string;
  kind: PermissionRequestKind;
  summary: string;
  outcome: PermissionOutcome;
  toolCallId?: string;
}

export type ContentBlock = TextBlock | ToolCallBlock | ReasoningBlock | ImageBlock | PermissionBlock;

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
  | { type: 'permission_request'; requestId: string; kind: PermissionRequestKind; summary: string; toolCallId?: string }
  | { type: 'permission_outcome'; requestId: string; outcome: Exclude<PermissionOutcome, 'pending'> }
  | { type: 'reconnecting' }
  | { type: 'done'; cancelled?: boolean }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'error'; message: string };

export interface ChatReplayEvent {
  sequence: number;
  mindId: string;
  messageId: string;
  event: ChatEvent;
}

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

export type ModelProvider = 'byo';

export interface ModelSelection {
  id: string;
  provider?: ModelProvider;
}

/** Shared mind context — safe for renderer consumption */
export interface MindContext {
  readonly mindId: string;
  readonly mindPath: string;
  readonly identity: MindIdentity;
  readonly status: MindStatus;
  readonly error?: string;
  selectedModel?: string;
  selectedModelProvider?: ModelProvider;
  activeSessionId?: string;
  readonly windowed?: boolean;
}

/** Persisted mind record in config */
export interface MindRecord {
  id: string;
  path: string;
  selectedModel?: string;
  selectedModelProvider?: ModelProvider;
  activeSessionId?: string;
  conversations?: ChamberConversationRecord[];
}

// ---------------------------------------------------------------------------
// Mind profiles — local profile editor contracts
// ---------------------------------------------------------------------------

export type AgentProfileFileKind = 'soul' | 'agent';

export interface AgentProfileFile {
  kind: AgentProfileFileKind;
  label: string;
  relativePath: string;
  content: string;
  exists: boolean;
  mtimeMs: number | null;
}

export interface AgentProfile {
  mindId: string;
  mindPath: string;
  displayName: string;
  folderName: string;
  avatarDataUrl: string | null;
  soul: AgentProfileFile;
  agentFiles: AgentProfileFile[];
  needsRestart: boolean;
  /**
   * True when this mind has opted in to the dream-daemon working-memory
   * consolidation pipeline (`.chamber.json` →
   * `workingMemory.consolidation.enabled`). Defaults to false when no
   * `.chamber.json` is present, matching `loadChamberMindConfig`.
   */
  dreamDaemonEnabled: boolean;
}

export interface AgentProfileSaveRequest {
  mindId: string;
  kind: AgentProfileFileKind;
  relativePath: string;
  content: string;
  expectedMtimeMs: number | null;
}

export type AgentProfileSaveResult =
  | { success: true; profile: AgentProfile; needsRestart: true }
  | { success: false; error: string; profile?: AgentProfile };

export interface AgentProfileAvatarSource {
  sourceId: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface AgentProfileAvatarCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AgentProfileAvatarSaveRequest {
  mindId: string;
  sourceId: string;
  crop: AgentProfileAvatarCrop;
}

export type AgentProfileAvatarPickResult =
  | { success: true; source: AgentProfileAvatarSource }
  | { success: false; error: string };

export type AgentProfileActionResult =
  | { success: true; profile: AgentProfile }
  | { success: false; error: string; profile?: AgentProfile };

// ---------------------------------------------------------------------------
// User profile — local Chamber profile for the signed-in human
// ---------------------------------------------------------------------------

export interface UserProfile {
  displayName: string;
  work: string;
  location: string;
  about: string;
  avatarDataUrl: string | null;
  source: 'local' | 'microsoft';
  microsoftAccount?: string;
  updatedAt: string | null;
}

export interface UserProfileSaveRequest {
  displayName?: string;
  work?: string;
  location?: string;
  about?: string;
  avatarDataUrl?: string | null;
}

export type UserProfileImportResult =
  | { success: true; profile: UserProfile; importedFields: Array<'displayName' | 'work' | 'location' | 'avatarDataUrl'> }
  | { success: false; error: string; cancelled?: boolean; profile?: UserProfile };

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
  /** Optional provider tag — set to 'byo' for models from a Bring-Your-Own LLM endpoint. Omitted for SDK/Copilot models. */
  provider?: ModelProvider;
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
  userProfile?: UserProfile;
  marketplaceRegistries?: MarketplaceRegistry[];
  installedTools?: InstalledTool[];
  a2aRelayBaseUrl?: string;
  a2aRelayAuthMode?: 'static' | 'interactive';
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

// ---------------------------------------------------------------------------
// BYO LLM (Bring Your Own LLM) — custom OpenAI-compatible endpoint config
// Maps to GitHub Copilot CLI's COPILOT_PROVIDER_* environment variables.
// ---------------------------------------------------------------------------

export type ByoLlmProviderType = 'openai' | 'azure' | 'anthropic';
export type ByoLlmWireApi = 'completions' | 'responses';

export interface ByoLlmConfig {
  enabled: boolean;
  baseUrl: string;
  providerType?: ByoLlmProviderType;
  apiKey?: string;
  bearerToken?: string;
  model?: string;
  modelId?: string;
  wireModel?: string;
  wireApi?: ByoLlmWireApi;
  azureApiVersion?: string;
  customHeaders?: Record<string, string>;
  maxPromptTokens?: number;
  maxOutputTokens?: number;
}

export interface ByoLlmProbeSuccess {
  ok: true;
  modelCount: number;
  models: Array<{ id: string; name?: string }>;
}

export interface ByoLlmProbeFailure {
  ok: false;
  error: string;
  status?: number;
}

export type ByoLlmProbeResult = ByoLlmProbeSuccess | ByoLlmProbeFailure;

export interface ByoLlmSaveResult {
  success: boolean;
  error?: string;
}

/**
 * Per-step progress event broadcast from the main process to all renderer
 * windows while the app boots. Drives the boot-screen activity log (#56) so
 * the user sees real work happening instead of a passive spinner.
 *
 * `kind` summarizes the step; `detail` is human-readable text to display
 * (e.g. mind name, error reason). Payload contents are display-safe — no
 * secrets, no file contents, no SDK event bodies.
 */
export type StartupProgressEventKind =
  | 'restore-start'
  | 'mind-restoring'
  | 'mind-restored'
  | 'mind-failed'
  | 'restore-complete';

export interface StartupProgressEvent {
  kind: StartupProgressEventKind;
  detail: string;
}

// `ElectronAPI` and the `Window.electronAPI` global declaration live in
// `./electron-types`. It is the single source of truth; import from
// `@chamber/shared/electron-types` directly. Intentionally NOT re-exported
// here to avoid a circular type dependency between this module and
// electron-types.

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
