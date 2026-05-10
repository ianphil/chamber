import { z } from 'zod';
import type { ChatEvent } from '@chamber/shared/types';

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
    kind: z.enum(['shell', 'write', 'mcp', 'read', 'url', 'custom-tool', 'memory', 'hook']),
    toolCallId: z.string().optional(),
    fullCommandText: z.string().optional(),     // shell
    intention: z.string().optional(),           // shell, read, url
    path: z.string().optional(),                // read
    paths: z.array(z.string()).optional(),      // write
    url: z.string().optional(),                 // url
    serverName: z.string().optional(),          // mcp
    toolTitle: z.string().optional(),           // mcp
    toolName: z.string().optional(),            // mcp, custom-tool
    fact: z.string().optional(),                // memory
    hookMessage: z.string().optional(),         // hook
  }).passthrough(),
});

const sdkPermissionCompletedEvent = sdkEvent({
  requestId: z.string(),
  result: z.object({
    kind: z.enum([
      'approved',
      'approved-for-session',
      'approved-for-location',
      'denied-by-rules',
      'denied-no-approval-rule-and-could-not-request-from-user',
      'denied-interactively-by-user',
      'denied-by-content-exclusion-policy',
      'denied-by-permission-request-hook',
    ]),
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
  kind: 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'custom-tool' | 'memory' | 'hook';
  fullCommandText?: string;
  intention?: string;
  path?: string;
  paths?: string[];
  url?: string;
  serverName?: string;
  toolTitle?: string;
  toolName?: string;
  fact?: string;
  hookMessage?: string;
}): string {
  switch (req.kind) {
    case 'shell':
      return preview(req.fullCommandText) || preview(req.intention) || 'shell command';
    case 'write':
      return preview((req.paths ?? []).join(', ')) || 'file write';
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
      return preview(req.hookMessage) || 'hook confirmation';
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
