// Shared A2A types — source-of-truth definitions for the A2A v1.0 protocol.
// Both main/ and renderer/ depend on these; this file must NOT import from either.

export type Role = 'user' | 'agent';

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
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input-required'
  | 'rejected'
  | 'auth-required';

const VALID_TASK_STATES: ReadonlySet<string> = new Set<TaskState>([
  'submitted',
  'working',
  'completed',
  'failed',
  'canceled',
  'input-required',
  'rejected',
  'auth-required',
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

export function isA2AIncomingPayload(value: unknown): value is A2AIncomingPayload {
  if (!isRecord(value)) return false;
  const message = value.message;
  if (!isRecord(message)) return false;
  return (
    typeof value.targetMindId === 'string' &&
    typeof value.replyMessageId === 'string' &&
    typeof message.messageId === 'string' &&
    (message.role === 'user' || message.role === 'agent') &&
    Array.isArray(message.parts)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
