// Shared A2A types — source-of-truth definitions for the A2A v1.0 protocol.
// Both main/ and renderer/ depend on these; this file must NOT import from either.

export type Role = 'ROLE_USER' | 'ROLE_AGENT';

export interface Part {
  text?: string;
  raw?: Uint8Array;
  url?: string;
  data?: unknown;
  mediaType?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface SendMessageRequest {
  recipient: string;
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

export interface SendMessageConfiguration {
  acceptedOutputModes?: string[];
  historyLength?: number;
  returnImmediately?: boolean;
}

export interface SendMessageResponse {
  task?: Task;
  message?: Message;
  queued?: boolean;
  queueMessageId?: string;
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED';

const VALID_TASK_STATES: ReadonlySet<string> = new Set<TaskState>([
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
]);

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && VALID_TASK_STATES.has(value);
}

export function narrowTaskState(value: unknown): TaskState | undefined {
  return isTaskState(value) ? value : undefined;
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  supportedInterfaces: AgentInterface[];
  provider?: AgentProvider;
  version: string;
  documentationUrl?: string;
  iconUrl?: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  /** Chamber-specific: the mindId for in-process routing */
  mindId?: string;
  /** Optional alternate recipient identifiers accepted by a relay. */
  aliases?: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  extensions?: AgentExtension[];
}

export interface AgentInterface {
  url: string;
  protocolBinding: string;
  tenant?: string;
  protocolVersion: string;
}

export interface AgentProvider {
  url: string;
  organization: string;
}

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GetTaskRequest {
  id: string;
  /** unset = no limit, 0 = exclude history */
  historyLength?: number;
}

export interface ListTasksRequest {
  contextId?: string;
  status?: TaskState;
  historyLength?: number;
}

export interface ListTasksResponse {
  tasks: Task[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}

export interface CancelTaskRequest {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface A2AIncomingPayload {
  targetMindId: string;
  message: Message;
  replyMessageId: string;
}

export interface A2ARelayQueuedMessage {
  id: string;
  recipient: string;
  request: SendMessageRequest;
  enqueuedAt: string;
  attempts: number;
}

export interface A2ARelayPollRequest {
  recipients: string[];
  limit?: number;
}

export interface A2ARelayPollResponse {
  messages: A2ARelayQueuedMessage[];
}

export interface A2ARelayAckRequest {
  messageIds: string[];
}

export interface A2ARelayAckResponse {
  acknowledged: number;
}

export type A2ARelayConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export interface A2ARelayStatus {
  state: A2ARelayConnectionState;
  mode: 'local' | 'relay';
  relayBaseUrl: string | null;
  publishedBaseUrl: string | null;
  publishedAgentCount: number;
  relayAgentCount: number;
  lastError: string | null;
  connectedAt: number | null;
}

export interface A2ARelayConnectRequest {
  relayBaseUrl: string;
  relayToken: string;
  publishedBaseUrl?: string;
  inboundToken?: string;
}

export function isA2ARelayConnectRequest(value: unknown): value is A2ARelayConnectRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.relayBaseUrl === 'string' &&
    value.relayBaseUrl.trim().length > 0 &&
    typeof value.relayToken === 'string' &&
    value.relayToken.trim().length > 0 &&
    (value.publishedBaseUrl === undefined || typeof value.publishedBaseUrl === 'string') &&
    (value.inboundToken === undefined || typeof value.inboundToken === 'string')
  );
}

export function isA2AIncomingPayload(value: unknown): value is A2AIncomingPayload {
  if (!isRecord(value)) return false;
  const message = value.message;
  if (!isRecord(message)) return false;
  return (
    typeof value.targetMindId === 'string' &&
    typeof value.replyMessageId === 'string' &&
    typeof message.messageId === 'string' &&
    (message.role === 'ROLE_USER' || message.role === 'ROLE_AGENT') &&
    Array.isArray(message.parts)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
