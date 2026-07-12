import { describe, it, expect, vi } from 'vitest';
import { mapSessionEventsToChatMessages } from './sessionTranscript';

describe('mapSessionEventsToChatMessages', () => {
  it('folds a rich assistant turn into ordered reasoning, tool, permission, and text blocks', () => {
    const events = [
      { type: 'user.message', timestamp: '2026-05-05T22:00:00.000Z', data: { messageId: 'u1', content: 'Deploy the API' } },
      { type: 'assistant.reasoning', timestamp: '2026-05-05T22:00:01.000Z', data: { reasoningId: 'r1', content: 'Check the pipeline first.' } },
      { type: 'tool.execution_start', timestamp: '2026-05-05T22:00:02.000Z', data: { toolCallId: 't1', toolName: 'run_shell', arguments: { command: 'ls -la' } } },
      { type: 'permission.requested', timestamp: '2026-05-05T22:00:03.000Z', data: { requestId: 'p1', permissionRequest: { kind: 'shell', fullCommandText: 'ls -la', toolCallId: 't1' } } },
      { type: 'permission.completed', timestamp: '2026-05-05T22:00:04.000Z', data: { requestId: 'p1', result: { kind: 'approved' } } },
      { type: 'tool.execution_complete', timestamp: '2026-05-05T22:00:05.000Z', data: { toolCallId: 't1', success: true, result: { content: 'file1\nfile2' } } },
      { type: 'assistant.message', timestamp: '2026-05-05T22:00:06.000Z', data: { messageId: 'a1', content: 'Done deploying.' } },
    ];

    const messages = mapSessionEventsToChatMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      blocks: [{ type: 'text', content: 'Deploy the API' }],
    });

    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.id).toBe('a1');
    expect(assistant.blocks).toEqual([
      { type: 'reasoning', reasoningId: 'r1', content: 'Check the pipeline first.' },
      { type: 'tool_call', toolCallId: 't1', toolName: 'run_shell', status: 'done', arguments: { command: 'ls -la' }, output: 'file1\nfile2' },
      { type: 'permission', requestId: 'p1', kind: 'shell', summary: 'ls -la', outcome: 'approved', toolCallId: 't1' },
      { type: 'text', sdkMessageId: 'a1', content: 'Done deploying.' },
    ]);
  });

  it('splits separate user turns into separate assistant messages', () => {
    const events = [
      { type: 'user.message', timestamp: '2026-05-05T22:00:00.000Z', data: { messageId: 'u1', content: 'First question' } },
      { type: 'assistant.message', timestamp: '2026-05-05T22:00:01.000Z', data: { messageId: 'a1', content: 'First answer' } },
      { type: 'user.message', timestamp: '2026-05-05T22:00:02.000Z', data: { messageId: 'u2', content: 'Second question' } },
      { type: 'assistant.message', timestamp: '2026-05-05T22:00:03.000Z', data: { messageId: 'a2', content: 'Second answer' } },
    ];

    const messages = mapSessionEventsToChatMessages(events);

    expect(messages.map((m) => ({ id: m.id, role: m.role }))).toEqual([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ]);
  });

  it('strips Chamber-injected datetime context from user messages', () => {
    const events = [
      {
        type: 'user.message',
        timestamp: '2026-05-05T22:00:00.000Z',
        data: {
          messageId: 'u1',
          content: '<current_datetime>\n2026-05-07T03:19:51.220Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nreal question',
        },
      },
    ];

    const messages = mapSessionEventsToChatMessages(events);

    expect(messages[0].blocks).toEqual([{ type: 'text', content: 'real question' }]);
  });

  it('skips malformed tool and permission events without throwing and keeps the rest of the turn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events = [
      { type: 'user.message', timestamp: '2026-05-05T22:00:00.000Z', data: { messageId: 'u1', content: 'go' } },
      { type: 'tool.execution_start', timestamp: '2026-05-05T22:00:01.000Z', data: { toolName: 'missing_id' } },
      { type: 'assistant.message', timestamp: '2026-05-05T22:00:02.000Z', data: { messageId: 'a1', content: 'still here' } },
    ];

    const messages = mapSessionEventsToChatMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1].blocks).toEqual([{ type: 'text', sdkMessageId: 'a1', content: 'still here' }]);
    warn.mockRestore();
  });

  it('marks a failed tool call as error with its message', () => {
    const events = [
      { type: 'tool.execution_start', timestamp: '2026-05-05T22:00:00.000Z', data: { toolCallId: 't1', toolName: 'grep', arguments: {} } },
      { type: 'tool.execution_complete', timestamp: '2026-05-05T22:00:01.000Z', data: { toolCallId: 't1', success: false, error: { message: 'no matches' } } },
    ];

    const messages = mapSessionEventsToChatMessages(events);

    expect(messages).toHaveLength(1);
    expect(messages[0].blocks[0]).toMatchObject({ type: 'tool_call', status: 'error', error: 'no matches' });
  });

  it('returns an empty array for an empty or non-object event log', () => {
    expect(mapSessionEventsToChatMessages([])).toEqual([]);
    expect(mapSessionEventsToChatMessages([null, 42, 'nope'])).toEqual([]);
  });
});
