import { z } from 'zod';
import type { PermissionRequest, SessionEventPayload } from '@github/copilot-sdk';
import type { ChatEvent, PermissionRequestKind, PermissionOutcome } from '@chamber/shared/types';

// Bind the local kind/outcome lists to the SDK-shipped types so any drift
// in `@github/copilot-sdk` (a new permission kind, a renamed completion
// kind) breaks `tsc --noEmit` instead of failing silently at runtime as
// an opaque `SdkChatEventContractError` in chat. Shared types stay
// literal because `@chamber/shared` is dependency-free; the linkage
// lives here in services where the SDK is already a peer.
type SdkPermissionRequestKind = PermissionRequest['kind'];
type SdkPermissionCompletedKind =
  SessionEventPayload<'permission.completed'>['data']['result']['kind'];

const PERMISSION_REQUEST_KINDS = [
  'shell',
  'write',
  'mcp',
  'read',
  'url',
  'custom-tool',
  'memory',
  'hook',
  'extension-management',
  'extension-permission-access',
] as const satisfies readonly SdkPermissionRequestKind[] & readonly PermissionRequestKind[];

const PERMISSION_COMPLETED_KINDS = [
  'approved',
  'approved-for-session',
  'approved-for-location',
  'denied-by-rules',
  'denied-no-approval-rule-and-could-not-request-from-user',
  'denied-interactively-by-user',
  'denied-by-content-exclusion-policy',
  'denied-by-permission-request-hook',
  'cancelled',
] as const satisfies readonly SdkPermissionCompletedKind[];

// Compile-time exhaustiveness — if the SDK adds a kind, the assignment
// below stops type-checking and CI fails loud.
const _exhaustiveRequestKinds: SdkPermissionRequestKind = '' as (typeof PERMISSION_REQUEST_KINDS)[number];
const _exhaustiveCompletedKinds: SdkPermissionCompletedKind = '' as (typeof PERMISSION_COMPLETED_KINDS)[number];
// Pair the local outcome alias with the SDK's completion kind set, and
// surface drift in either direction as a type error.
const _exhaustiveOutcomeAlias: Exclude<PermissionOutcome, 'pending'> =
  '' as SdkPermissionCompletedKind;
void _exhaustiveRequestKinds;
void _exhaustiveCompletedKinds;
void _exhaustiveOutcomeAlias;

const sdkEvent = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ data: z.object(shape).passthrough() }).passthrough();

export class SdkChatEventContractError extends Error {
  readonly eventName: string;

  constructor(
    eventName: string,
    cause: unknown,
  ) {
    super(`SDK contract mismatch for ${eventName}`, { cause });
    this.eventName = eventName;
    this.name = 'SdkChatEventContractError';
  }
}

const sdkAssistantMessageDeltaEvent = sdkEvent({
  messageId: z.string(),
  deltaContent: z.string(),
});

const sdkAssistantMessageEvent = sdkEvent({
  messageId: z.string(),
  content: z.string().optional(),
});

const sdkAssistantReasoningDeltaEvent = sdkEvent({
  reasoningId: z.string(),
  deltaContent: z.string(),
});

const sdkToolExecutionStartEvent = sdkEvent({
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  parentToolCallId: z.string().optional(),
});

const sdkToolExecutionProgressEvent = sdkEvent({
  toolCallId: z.string(),
  progressMessage: z.string(),
});

const sdkToolExecutionPartialResultEvent = sdkEvent({
  toolCallId: z.string(),
  partialOutput: z.string(),
});

const sdkToolExecutionCompleteEvent = sdkEvent({
  toolCallId: z.string(),
  success: z.boolean(),
  result: z.object({ content: z.string().optional() }).passthrough().optional(),
  error: z.object({ message: z.string().optional() }).passthrough().optional(),
});

const sdkSessionErrorEvent = sdkEvent({
  message: z.string(),
});

// permission.requested — full request details from the SDK session event.
// We model the kind-specific fields with optional+passthrough so the schema
// validates regardless of which permission kind fires.
const sdkPermissionRequestedEvent = sdkEvent({
  requestId: z.string(),
  permissionRequest: z.object({
    kind: z.enum(PERMISSION_REQUEST_KINDS),
    toolCallId: z.string().optional(),
    fullCommandText: z.string().optional(),     // shell
    intention: z.string().optional(),           // shell, read, url, write
    path: z.string().optional(),                // read
    fileName: z.string().optional(),            // write
    url: z.string().optional(),                 // url
    serverName: z.string().optional(),          // mcp
    toolTitle: z.string().optional(),           // mcp
    toolName: z.string().optional(),            // mcp, custom-tool, hook
    fact: z.string().optional(),                // memory
    hookMessage: z.string().optional(),         // hook
    operation: z.string().optional(),           // extension-management
    extensionName: z.string().optional(),       // extension-management, extension-permission-access
  }).passthrough(),
});

const sdkPermissionCompletedEvent = sdkEvent({
  requestId: z.string(),
  result: z.object({
    kind: z.enum(PERMISSION_COMPLETED_KINDS),
  }).passthrough(),
  toolCallId: z.string().optional(),
});

function parseSdkEvent<Schema extends z.ZodTypeAny>(
  eventName: string,
  schema: Schema,
  event: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(event);
  if (!parsed.success) {
    throw new SdkChatEventContractError(eventName, parsed.error);
  }
  return parsed.data;
}

function normalizeToolArguments(value: Record<string, unknown> | string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { input: value };
  }

  return { input: value };
}

export function mapSdkAssistantMessageDelta(event: unknown): Extract<ChatEvent, { type: 'chunk' }> {
  const parsed = parseSdkEvent('assistant.message_delta', sdkAssistantMessageDeltaEvent, event);
  return {
    type: 'chunk',
    sdkMessageId: parsed.data.messageId,
    content: parsed.data.deltaContent,
  };
}

export function mapSdkAssistantMessage(event: unknown): Extract<ChatEvent, { type: 'message_final' }> | null {
  const parsed = parseSdkEvent('assistant.message', sdkAssistantMessageEvent, event);
  if (!parsed.data.content) return null;
  return {
    type: 'message_final',
    sdkMessageId: parsed.data.messageId,
    content: parsed.data.content,
  };
}

export function mapSdkAssistantReasoningDelta(event: unknown): Extract<ChatEvent, { type: 'reasoning' }> {
  const parsed = parseSdkEvent('assistant.reasoning_delta', sdkAssistantReasoningDeltaEvent, event);
  return {
    type: 'reasoning',
    reasoningId: parsed.data.reasoningId,
    content: parsed.data.deltaContent,
  };
}

export function mapSdkToolExecutionStart(event: unknown): Extract<ChatEvent, { type: 'tool_start' }> {
  const parsed = parseSdkEvent('tool.execution_start', sdkToolExecutionStartEvent, event);
  return {
    type: 'tool_start',
    toolCallId: parsed.data.toolCallId,
    toolName: parsed.data.toolName,
    args: normalizeToolArguments(parsed.data.arguments),
    parentToolCallId: parsed.data.parentToolCallId,
  };
}

export function mapSdkToolExecutionProgress(event: unknown): Extract<ChatEvent, { type: 'tool_progress' }> {
  const parsed = parseSdkEvent('tool.execution_progress', sdkToolExecutionProgressEvent, event);
  return {
    type: 'tool_progress',
    toolCallId: parsed.data.toolCallId,
    message: parsed.data.progressMessage,
  };
}

export function mapSdkToolExecutionPartialResult(event: unknown): Extract<ChatEvent, { type: 'tool_output' }> {
  const parsed = parseSdkEvent('tool.execution_partial_result', sdkToolExecutionPartialResultEvent, event);
  return {
    type: 'tool_output',
    toolCallId: parsed.data.toolCallId,
    output: parsed.data.partialOutput,
  };
}

export function mapSdkToolExecutionComplete(event: unknown): Extract<ChatEvent, { type: 'tool_done' }> {
  const parsed = parseSdkEvent('tool.execution_complete', sdkToolExecutionCompleteEvent, event);
  return {
    type: 'tool_done',
    toolCallId: parsed.data.toolCallId,
    success: parsed.data.success,
    result: parsed.data.result?.content,
    error: parsed.data.error?.message,
  };
}

export function getSdkSessionErrorMessage(event: unknown): string {
  const parsed = parseSdkEvent('session.error', sdkSessionErrorEvent, event);
  return parsed.data.message;
}

const PREVIEW_MAX = 80;

function preview(value: string | undefined): string {
  if (!value) return '';
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > PREVIEW_MAX ? `${single.slice(0, PREVIEW_MAX - 1)}…` : single;
}

function summarizePermissionRequest(req: {
  kind: PermissionRequestKind;
  fullCommandText?: string;
  intention?: string;
  path?: string;
  fileName?: string;
  url?: string;
  serverName?: string;
  toolTitle?: string;
  toolName?: string;
  fact?: string;
  hookMessage?: string;
  operation?: string;
  extensionName?: string;
}): string {
  switch (req.kind) {
    case 'shell':
      return preview(req.fullCommandText) || preview(req.intention) || 'shell command';
    case 'write':
      return preview(req.fileName) || preview(req.intention) || 'file write';
    case 'read':
      return preview(req.path) || preview(req.intention) || 'read';
    case 'url':
      return preview(req.url) || preview(req.intention) || 'url access';
    case 'mcp':
      return preview([req.serverName, req.toolTitle ?? req.toolName].filter(Boolean).join(': ')) || 'mcp';
    case 'custom-tool':
      return preview(req.toolName) || 'custom tool';
    case 'memory':
      return preview(req.fact) || 'memory';
    case 'hook':
      return preview(req.hookMessage) || preview(req.toolName) || 'hook confirmation';
    case 'extension-management':
      return preview(req.operation) || preview(req.extensionName) || 'extension management';
    case 'extension-permission-access':
      return preview(req.extensionName) || 'extension permission access';
    default:
      return req.kind;
  }
}

export function mapSdkPermissionRequested(event: unknown): Extract<ChatEvent, { type: 'permission_request' }> {
  const parsed = parseSdkEvent('permission.requested', sdkPermissionRequestedEvent, event);
  const req = parsed.data.permissionRequest;
  return {
    type: 'permission_request',
    requestId: parsed.data.requestId,
    kind: req.kind,
    summary: summarizePermissionRequest(req),
    ...(req.toolCallId ? { toolCallId: req.toolCallId } : {}),
  };
}

export function mapSdkPermissionCompleted(event: unknown): Extract<ChatEvent, { type: 'permission_outcome' }> {
  const parsed = parseSdkEvent('permission.completed', sdkPermissionCompletedEvent, event);
  return {
    type: 'permission_outcome',
    requestId: parsed.data.requestId,
    outcome: parsed.data.result.kind,
  };
}
