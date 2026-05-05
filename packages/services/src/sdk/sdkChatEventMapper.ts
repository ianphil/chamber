import { z } from 'zod';
import type { ChatEvent } from '@chamber/shared/types';

const sdkEvent = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ data: z.object(shape).passthrough() }).passthrough();

export class SdkChatEventContractError extends Error {
  constructor(
    readonly eventName: string,
    cause: unknown,
  ) {
    super(`SDK contract mismatch for ${eventName}`, { cause });
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
  arguments: z.record(z.string(), z.unknown()).optional(),
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
    args: parsed.data.arguments,
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

