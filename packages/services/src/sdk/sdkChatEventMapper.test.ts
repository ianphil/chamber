import { describe, expect, it } from 'vitest';
import {
  SdkChatEventContractError,
  getSdkSessionErrorMessage,
  mapSdkAssistantMessage,
  mapSdkAssistantMessageDelta,
  mapSdkAssistantReasoningDelta,
  mapSdkPermissionCompleted,
  mapSdkPermissionRequested,
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

  it('maps JSON-string tool arguments emitted by the SDK into Chamber argument records', () => {
    expect(mapSdkToolExecutionStart({
      data: {
        toolCallId: 'tool-1',
        toolName: 'powershell',
        arguments: '{"command":"git status","description":"Check status"}',
      },
    })).toEqual({
      type: 'tool_start',
      toolCallId: 'tool-1',
      toolName: 'powershell',
      args: { command: 'git status', description: 'Check status' },
      parentToolCallId: undefined,
    });
  });

  it('preserves non-JSON string tool arguments without failing chat streaming', () => {
    expect(mapSdkToolExecutionStart({
      data: {
        toolCallId: 'tool-1',
        toolName: 'apply_patch',
        arguments: '*** Begin Patch\n*** End Patch',
      },
    })).toEqual({
      type: 'tool_start',
      toolCallId: 'tool-1',
      toolName: 'apply_patch',
      args: { input: '*** Begin Patch\n*** End Patch' },
      parentToolCallId: undefined,
    });
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

  describe('permission events (issue #131 checklist 5)', () => {
    it('maps a shell permission.requested event with the full command text as the summary', () => {
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-1',
          permissionRequest: {
            kind: 'shell',
            toolCallId: 'tool-1',
            fullCommandText: 'git status',
            intention: 'check repo status',
          },
        },
      });
      expect(mapped).toEqual({
        type: 'permission_request',
        requestId: 'req-1',
        kind: 'shell',
        summary: 'git status',
        toolCallId: 'tool-1',
      });
    });

    it('maps a write permission.requested event with the affected file name', () => {
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-2',
          permissionRequest: {
            kind: 'write',
            fileName: './README.md',
            diff: '--- a/README.md\n+++ b/README.md\n',
            intention: 'document the change',
          },
        },
      });
      expect(mapped).toEqual({
        type: 'permission_request',
        requestId: 'req-2',
        kind: 'write',
        summary: './README.md',
      });
    });

    it('maps a url permission.requested event with the requested url', () => {
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-3',
          permissionRequest: {
            kind: 'url',
            url: 'https://api.github.com/repos/ianphil/chamber',
            intention: 'fetch repo metadata',
          },
        },
      });
      expect(mapped.kind).toBe('url');
      expect(mapped.summary).toBe('https://api.github.com/repos/ianphil/chamber');
    });

    it('truncates long summaries so the chat UI does not blow up', () => {
      const longCommand = 'echo "' + 'x'.repeat(200) + '"';
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-4',
          permissionRequest: { kind: 'shell', fullCommandText: longCommand },
        },
      });
      expect(mapped.summary.length).toBeLessThanOrEqual(80);
      expect(mapped.summary.endsWith('…')).toBe(true);
    });

    it('falls back to a kind-derived label when no detail field is present', () => {
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-5',
          permissionRequest: { kind: 'memory' },
        },
      });
      expect(mapped.summary).toBe('memory');
    });

    it('falls back to the gated tool name when a hook permission has no message', () => {
      const mapped = mapSdkPermissionRequested({
        data: {
          requestId: 'req-6',
          permissionRequest: { kind: 'hook', toolName: 'bash' },
        },
      });
      expect(mapped.summary).toBe('bash');
    });

    it('maps a permission.completed approved event to a permission_outcome event', () => {
      const mapped = mapSdkPermissionCompleted({
        data: {
          requestId: 'req-1',
          result: { kind: 'approved-for-session' },
          toolCallId: 'tool-1',
        },
      });
      expect(mapped).toEqual({
        type: 'permission_outcome',
        requestId: 'req-1',
        outcome: 'approved-for-session',
      });
    });

    it('maps a permission.completed denied-* event without losing the denial reason', () => {
      const mapped = mapSdkPermissionCompleted({
        data: {
          requestId: 'req-2',
          result: { kind: 'denied-by-content-exclusion-policy' },
        },
      });
      expect(mapped.outcome).toBe('denied-by-content-exclusion-policy');
    });

    it('rejects permission events with unexpected kinds so contract drift surfaces fast', () => {
      expect(() => mapSdkPermissionRequested({
        data: {
          requestId: 'req-x',
          permissionRequest: { kind: 'totally-new-kind' },
        },
      })).toThrow(SdkChatEventContractError);

      expect(() => mapSdkPermissionCompleted({
        data: {
          requestId: 'req-x',
          result: { kind: 'sometimes-approved' },
        },
      })).toThrow(SdkChatEventContractError);
    });
  });
});
