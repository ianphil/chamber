import { describe, expect, it } from 'vitest';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkToolExecutionComplete,
  mapSdkToolExecutionPartialResult,
  mapSdkToolExecutionProgress,
  mapSdkToolExecutionStart,
} from './sdkChatEventMapper';

describe('sdkChatEventMapper', () => {
  it('maps the SDK event shapes ChatService consumes into Chamber chat events', () => {
    expect(mapSdkAssistantMessageDelta({
      data: { messageId: 'sdk-message-1', deltaContent: 'hello', extra: true },
    })).toEqual({ type: 'chunk', sdkMessageId: 'sdk-message-1', content: 'hello' });

    expect(mapSdkAssistantMessage({
      data: { messageId: 'sdk-message-1', content: 'hello world' },
    })).toEqual({ type: 'message_final', sdkMessageId: 'sdk-message-1', content: 'hello world' });

    expect(mapSdkAssistantReasoningDelta({
      data: { reasoningId: 'reasoning-1', deltaContent: 'thinking' },
    })).toEqual({ type: 'reasoning', reasoningId: 'reasoning-1', content: 'thinking' });

    expect(mapSdkToolExecutionStart({
      data: {
        toolCallId: 'tool-1',
        toolName: 'read_file',
        arguments: { path: 'README.md' },
        parentToolCallId: 'parent-tool-1',
      },
    })).toEqual({
      type: 'tool_start',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      args: { path: 'README.md' },
      parentToolCallId: 'parent-tool-1',
    });

    expect(mapSdkToolExecutionProgress({
      data: { toolCallId: 'tool-1', progressMessage: 'Reading README.md' },
    })).toEqual({ type: 'tool_progress', toolCallId: 'tool-1', message: 'Reading README.md' });

    expect(mapSdkToolExecutionPartialResult({
      data: { toolCallId: 'tool-1', partialOutput: 'partial output' },
    })).toEqual({ type: 'tool_output', toolCallId: 'tool-1', output: 'partial output' });

    expect(mapSdkToolExecutionComplete({
      data: {
        toolCallId: 'tool-1',
        success: true,
        result: { content: 'complete output', extra: true },
      },
    })).toEqual({
      type: 'tool_done',
      toolCallId: 'tool-1',
      success: true,
      result: 'complete output',
      error: undefined,
    });

    expect(getSdkSessionErrorMessage({ data: { message: 'SDK session failed' } })).toBe('SDK session failed');
  });

  it('rejects SDK event drift that would break chat streaming assumptions', () => {
    expect(() => mapSdkAssistantMessageDelta({
      data: { id: 'sdk-message-1', text: 'hello' },
    })).toThrow(SdkChatEventContractError);

    expect(() => mapSdkToolExecutionComplete({
      data: { toolCallId: 'tool-1', success: 'yes' },
    })).toThrow('SDK contract mismatch for tool.execution_complete');

    expect(() => getSdkSessionErrorMessage({
      data: { error: 'SDK session failed' },
    })).toThrow('SDK contract mismatch for session.error');
  });
});

