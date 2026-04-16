/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { handleChatEvent, appReducer, initialState } from '.';
import type { AppState, AppAction } from '.';
import type { ChatMessage } from '../../../shared/types';
import type { Message, Task, TaskStatus, Artifact } from '../../../shared/a2a-types';
import {
  makeMessage,
  makeTextBlock,
  makeToolCallBlock,
  makeReasoningBlock,
  makeChatEvent,
  makeModelInfo,
  makeLensViewManifest,
} from '../../../test/helpers';

// ---------------------------------------------------------------------------
// handleChatEvent
// ---------------------------------------------------------------------------

function assistantMsg(id = 'msg-1'): ChatMessage[] {
  return [makeMessage([], { id, isStreaming: true })];
}

describe('handleChatEvent', () => {
  describe('chunk', () => {
    it('creates a TextBlock on the first chunk', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('chunk', { content: 'Hello' }));
      expect(msgs[0].blocks).toHaveLength(1);
      expect(msgs[0].blocks[0]).toEqual({ type: 'text', content: 'Hello', sdkMessageId: undefined });
    });

    it('appends to existing TextBlock', () => {
      const initial = [makeMessage([makeTextBlock('Hello')], { id: 'msg-1', isStreaming: true })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('chunk', { content: ' World' }));
      expect(msgs[0].blocks[0]).toMatchObject({ type: 'text', content: 'Hello World' });
    });

    it('creates new TextBlock after a tool block', () => {
      const initial = [makeMessage([makeToolCallBlock()], { id: 'msg-1', isStreaming: true })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('chunk', { content: 'After tool' }));
      expect(msgs[0].blocks).toHaveLength(2);
      expect(msgs[0].blocks[1]).toMatchObject({ type: 'text', content: 'After tool' });
    });

    it('sets sdkMessageId on the text block', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('chunk', { content: 'x', sdkMessageId: 'sdk-1' }));
      expect(msgs[0].blocks[0]).toMatchObject({ sdkMessageId: 'sdk-1' });
    });
  });

  describe('tool_start', () => {
    it('creates a tool_call block with running status', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('tool_start', { toolCallId: 'tc1', toolName: 'readFile' }));
      expect(msgs[0].blocks[0]).toMatchObject({ type: 'tool_call', toolCallId: 'tc1', toolName: 'readFile', status: 'running' });
    });

    it('includes arguments when provided', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('tool_start', { toolCallId: 'tc1', toolName: 'grep', args: { pattern: 'foo' } }));
      expect(msgs[0].blocks[0]).toMatchObject({ arguments: { pattern: 'foo' } });
    });

    it('includes parentToolCallId when provided', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('tool_start', { toolCallId: 'tc1', toolName: 'grep', parentToolCallId: 'tc0' }));
      expect(msgs[0].blocks[0]).toMatchObject({ parentToolCallId: 'tc0' });
    });
  });

  describe('tool_progress', () => {
    it('appends progress message to tool block output', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_progress', { toolCallId: 'tc1', message: 'line1' }));
      expect(msgs[0].blocks[0]).toMatchObject({ output: expect.stringContaining('line1') });
    });

    it('accumulates multiple progress messages', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      let msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_progress', { toolCallId: 'tc1', message: 'a' }));
      msgs = handleChatEvent(msgs, 'msg-1', makeChatEvent('tool_progress', { toolCallId: 'tc1', message: 'b' }));
      expect(msgs[0].blocks[0]).toMatchObject({ output: expect.stringContaining('a') });
      expect(msgs[0].blocks[0]).toMatchObject({ output: expect.stringContaining('b') });
    });
  });

  describe('tool_output', () => {
    it('appends output to tool block', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_output', { toolCallId: 'tc1', output: 'result data' }));
      expect(msgs[0].blocks[0]).toMatchObject({ output: expect.stringContaining('result data') });
    });
  });

  describe('tool_done', () => {
    it('sets status to done on success', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_done', { toolCallId: 'tc1', success: true }));
      expect(msgs[0].blocks[0]).toMatchObject({ status: 'done' });
    });

    it('sets status to error on failure', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_done', { toolCallId: 'tc1', success: false, error: 'fail' }));
      expect(msgs[0].blocks[0]).toMatchObject({ status: 'error', error: 'fail' });
    });

    it('appends result to output when provided', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_done', { toolCallId: 'tc1', success: true, result: 'ok' }));
      expect(msgs[0].blocks[0]).toMatchObject({ output: expect.stringContaining('ok') });
    });

    it('is a no-op for unknown toolCallId', () => {
      const initial = [makeMessage([makeToolCallBlock({ toolCallId: 'tc1' })], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('tool_done', { toolCallId: 'unknown', success: true }));
      expect(msgs[0].blocks[0]).toMatchObject({ status: 'running' });
    });
  });

  describe('reasoning', () => {
    it('creates a ReasoningBlock', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('reasoning', { reasoningId: 'r1', content: 'thinking' }));
      expect(msgs[0].blocks[0]).toMatchObject({ type: 'reasoning', reasoningId: 'r1', content: 'thinking' });
    });

    it('appends to existing block with same id', () => {
      const initial = [makeMessage([makeReasoningBlock('a', 'r1')], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('reasoning', { reasoningId: 'r1', content: 'b' }));
      expect(msgs[0].blocks[0]).toMatchObject({ content: 'ab' });
    });

    it('creates new block for different id', () => {
      const initial = [makeMessage([makeReasoningBlock('a', 'r1')], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('reasoning', { reasoningId: 'r2', content: 'b' }));
      expect(msgs[0].blocks).toHaveLength(2);
    });
  });

  describe('message_final', () => {
    it('creates text block when no text blocks exist', () => {
      const msgs = handleChatEvent(assistantMsg(), 'msg-1', makeChatEvent('message_final', { sdkMessageId: 'sdk-1', content: 'Final' }));
      expect(msgs[0].blocks[0]).toMatchObject({ type: 'text', content: 'Final' });
    });

    it('is a no-op when same sdkMessageId text already exists', () => {
      const initial = [makeMessage([makeTextBlock('existing', 'sdk-1')], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('message_final', { sdkMessageId: 'sdk-1', content: 'Final' }));
      expect(msgs[0].blocks).toHaveLength(1);
      expect(msgs[0].blocks[0]).toMatchObject({ content: 'existing' });
    });

    it('adds text block when message_final has a different sdkMessageId than existing text', () => {
      const initial = [makeMessage([makeTextBlock('first turn', 'sdk-1'), makeToolCallBlock()], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('message_final', { sdkMessageId: 'sdk-2', content: 'Final response after tools' }));
      expect(msgs[0].blocks).toHaveLength(3);
      expect(msgs[0].blocks[2]).toMatchObject({ type: 'text', content: 'Final response after tools', sdkMessageId: 'sdk-2' });
    });
  });

  describe('done', () => {
    it('sets isStreaming to false', () => {
      const initial = [makeMessage([], { id: 'msg-1', isStreaming: true })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('done'));
      expect(msgs[0].isStreaming).toBe(false);
    });
  });

  describe('error', () => {
    it('adds error text block and sets isStreaming false', () => {
      const initial = [makeMessage([], { id: 'msg-1', isStreaming: true })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('error', { message: 'timeout' }));
      expect(msgs[0].isStreaming).toBe(false);
      expect(msgs[0].blocks[msgs[0].blocks.length - 1]).toMatchObject({ type: 'text', content: 'Error: timeout' });
    });
  });

  it('ignores events for unknown messageId', () => {
    const initial = assistantMsg();
    const msgs = handleChatEvent(initial, 'wrong-id', makeChatEvent('chunk', { content: 'x' }));
    expect(msgs[0].blocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appReducer
// ---------------------------------------------------------------------------

describe('appReducer', () => {
  // Helper: set up a state with an active mind for message tests
  const mindId = 'test-mind';
  const withActiveMind: AppState = {
    ...initialState,
    minds: [{ mindId, mindPath: 'C:\\test', identity: { name: 'Test', systemMessage: '' }, status: 'ready' }],
    activeMindId: mindId,
  };
  const getMsgs = (s: AppState) => s.messagesByMind[mindId] ?? [];

  it('ADD_USER_MESSAGE adds a user message to active mind', () => {
    const state = appReducer(withActiveMind, { type: 'ADD_USER_MESSAGE', payload: { id: 'u1', content: 'Hello', timestamp: 1000 } });
    expect(getMsgs(state)).toHaveLength(1);
    expect(getMsgs(state)[0]).toMatchObject({ id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'Hello' }] });
  });

  it('ADD_ASSISTANT_MESSAGE adds a streaming assistant message', () => {
    const state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    expect(getMsgs(state)).toHaveLength(1);
    expect(getMsgs(state)[0]).toMatchObject({ id: 'a1', role: 'assistant', blocks: [], isStreaming: true });
    expect(state.isStreaming).toBe(true);
  });

  it('CHAT_EVENT delegates to handleChatEvent for the correct mind', () => {
    let state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { mindId, messageId: 'a1', event: makeChatEvent('chunk', { content: 'Hi' }) } });
    expect(getMsgs(state)[0].blocks[0]).toMatchObject({ type: 'text', content: 'Hi' });
  });

  it('CHAT_EVENT with done sets isStreaming false', () => {
    let state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { mindId, messageId: 'a1', event: makeChatEvent('done') } });
    expect(state.isStreaming).toBe(false);
  });

  it('CHAT_EVENT with error sets isStreaming false', () => {
    let state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { mindId, messageId: 'a1', event: makeChatEvent('error', { message: 'fail' }) } });
    expect(state.isStreaming).toBe(false);
  });

  it('SET_MINDS updates minds array', () => {
    const minds = [{ mindId: 'a', mindPath: '/a', identity: { name: 'A', systemMessage: '' }, status: 'ready' as const }];
    const state = appReducer(initialState, { type: 'SET_MINDS', payload: minds });
    expect(state.minds).toEqual(minds);
  });

  it('SET_ACTIVE_MIND switches active mind', () => {
    const state = appReducer(withActiveMind, { type: 'SET_ACTIVE_MIND', payload: 'other-mind' });
    expect(state.activeMindId).toBe('other-mind');
  });

  it('ADD_MIND appends a new mind and sets it active if none active', () => {
    const mind = { mindId: 'new', mindPath: '/new', identity: { name: 'New', systemMessage: '' }, status: 'ready' as const };
    const state = appReducer(initialState, { type: 'ADD_MIND', payload: mind });
    expect(state.minds).toHaveLength(1);
    expect(state.activeMindId).toBe('new');
  });

  it('ADD_MIND does not duplicate existing mind', () => {
    const mind = withActiveMind.minds[0];
    const state = appReducer(withActiveMind, { type: 'ADD_MIND', payload: mind });
    expect(state.minds).toHaveLength(1);
  });

  it('REMOVE_MIND removes mind and clears its messages', () => {
    const stateWithMsgs = { ...withActiveMind, messagesByMind: { [mindId]: [makeMessage([makeTextBlock('hi')])] } };
    const state = appReducer(stateWithMsgs, { type: 'REMOVE_MIND', payload: mindId });
    expect(state.minds).toHaveLength(0);
    expect(state.messagesByMind[mindId]).toBeUndefined();
    expect(state.activeMindId).toBeNull();
    expect(state.showLanding).toBe(true);
  });

  it('REMOVE_MIND falls back active to next mind', () => {
    const twoMinds: AppState = {
      ...withActiveMind,
      minds: [
        withActiveMind.minds[0],
        { mindId: 'other', mindPath: '/other', identity: { name: 'Other', systemMessage: '' }, status: 'ready' },
      ],
    };
    const state = appReducer(twoMinds, { type: 'REMOVE_MIND', payload: mindId });
    expect(state.activeMindId).toBe('other');
  });

  it('SET_AVAILABLE_MODELS updates model list', () => {
    const models = [makeModelInfo('m1', 'Model 1'), makeModelInfo('m2', 'Model 2')];
    const state = appReducer(initialState, { type: 'SET_AVAILABLE_MODELS', payload: models });
    expect(state.availableModels).toEqual(models);
  });

  it('SET_SELECTED_MODEL updates selection and persists to localStorage', () => {
    const state = appReducer(initialState, { type: 'SET_SELECTED_MODEL', payload: 'model-1' });
    expect(state.selectedModel).toBe('model-1');
    expect(localStorage.getItem('chamber:selectedModel')).toBe('model-1');
  });

  it('SET_SELECTED_MODEL with null clears selection', () => {
    localStorage.setItem('chamber:selectedModel', 'old');
    const state = appReducer(initialState, { type: 'SET_SELECTED_MODEL', payload: null });
    expect(state.selectedModel).toBeNull();
    expect(localStorage.getItem('chamber:selectedModel')).toBeNull();
  });

  it('SET_ACTIVE_VIEW updates activeView', () => {
    const state = appReducer(initialState, { type: 'SET_ACTIVE_VIEW', payload: 'briefing-1' });
    expect(state.activeView).toBe('briefing-1');
  });

  it('SET_DISCOVERED_VIEWS updates discoveredViews', () => {
    const views = [makeLensViewManifest({ id: 'v1' })];
    const state = appReducer(initialState, { type: 'SET_DISCOVERED_VIEWS', payload: views });
    expect(state.discoveredViews).toEqual(views);
  });

  it('SHOW_LANDING sets showLanding true', () => {
    const state = appReducer(initialState, { type: 'SHOW_LANDING' });
    expect(state.showLanding).toBe(true);
  });

  it('HIDE_LANDING sets showLanding false', () => {
    const state = appReducer({ ...initialState, showLanding: true }, { type: 'HIDE_LANDING' });
    expect(state.showLanding).toBe(false);
  });

  it('ACCOUNT_SWITCH_STARTED enters switching-account runtime phase', () => {
    const state = appReducer(initialState, { type: 'ACCOUNT_SWITCH_STARTED', payload: { login: 'bob' } });
    expect(state.runtimePhase).toBe('switching-account');
    expect(state.switchingAccountLogin).toBe('bob');
  });

  it('ACCOUNT_SWITCH_COMPLETED clears switching-account runtime phase', () => {
    const switchingState = {
      ...initialState,
      runtimePhase: 'switching-account' as const,
      switchingAccountLogin: 'bob',
    };
    const state = appReducer(switchingState, { type: 'ACCOUNT_SWITCH_COMPLETED' });
    expect(state.runtimePhase).toBe('ready');
    expect(state.switchingAccountLogin).toBeNull();
  });

  it('LOGGED_OUT resets switching state back to ready', () => {
    const switchingState = {
      ...initialState,
      runtimePhase: 'switching-account' as const,
      switchingAccountLogin: 'bob',
    };
    const state = appReducer(switchingState, { type: 'LOGGED_OUT' });
    expect(state.runtimePhase).toBe('ready');
    expect(state.switchingAccountLogin).toBeNull();
  });

  it('CLEAR_MESSAGES empties messages for active mind', () => {
    const stateWithMsgs = { ...withActiveMind, messagesByMind: { [mindId]: [makeMessage([makeTextBlock('hi')])] } };
    const state = appReducer(stateWithMsgs, { type: 'CLEAR_MESSAGES' });
    expect(getMsgs(state)).toHaveLength(0);
  });

  it('NEW_CONVERSATION resets messages and streaming for active mind', () => {
    const prev = { ...withActiveMind, messagesByMind: { [mindId]: [makeMessage([])] }, isStreaming: true };
    const state = appReducer(prev, { type: 'NEW_CONVERSATION' });
    expect(getMsgs(state)).toHaveLength(0);
    expect(state.isStreaming).toBe(false);
  });

  it('unknown action returns state unchanged', () => {
    const state = appReducer(initialState, { type: 'BOGUS' } as unknown as AppAction);
    expect(state).toBe(initialState);
  });

  // -------------------------------------------------------------------------
  // A2A_INCOMING
  // -------------------------------------------------------------------------

  describe('A2A_INCOMING', () => {
    const a2aPayload = (overrides?: Partial<{ targetMindId: string; message: Message; replyMessageId: string }>) => ({
      targetMindId: mindId,
      message: {
        messageId: 'msg-a2a-1',
        role: 'user',
        parts: [{ text: 'Hello from Agent A', mediaType: 'text/plain' }],
        metadata: { fromId: 'agent-a', fromName: 'Agent A', hopCount: 1 },
      },
      replyMessageId: 'reply-1',
      ...overrides,
    });

    it('inserts sender message with attribution into target mind', () => {
      const state = appReducer(withActiveMind, { type: 'A2A_INCOMING', payload: a2aPayload() });
      const msgs = state.messagesByMind[mindId];
      if (!msgs) throw new Error('expected messages for mind');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].sender).toEqual({ mindId: 'agent-a', name: 'Agent A' });
      expect(msgs[0].blocks[0]).toMatchObject({ type: 'text', content: 'Hello from Agent A' });
    });

    it('inserts assistant reply placeholder', () => {
      const state = appReducer(withActiveMind, { type: 'A2A_INCOMING', payload: a2aPayload() });
      const msgs = state.messagesByMind[mindId];
      if (!msgs) throw new Error('expected messages for mind');
      expect(msgs[1].id).toBe('reply-1');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].isStreaming).toBe(true);
    });

    it('sets streamingByMind for target mind', () => {
      const state = appReducer(withActiveMind, { type: 'A2A_INCOMING', payload: a2aPayload() });
      expect(state.streamingByMind[mindId]).toBe(true);
    });

    it('sets global isStreaming true when target is active mind', () => {
      const state = appReducer(withActiveMind, { type: 'A2A_INCOMING', payload: a2aPayload() });
      expect(state.isStreaming).toBe(true);
    });

    it('does not set global isStreaming when target is not active mind', () => {
      const state = appReducer(withActiveMind, {
        type: 'A2A_INCOMING',
        payload: a2aPayload({ targetMindId: 'other-mind' }),
      });
      expect(state.isStreaming).toBe(false);
      expect(state.streamingByMind['other-mind']).toBe(true);
    });

    it('appends to existing messages in target mind', () => {
      const stateWithMsgs = {
        ...withActiveMind,
        messagesByMind: { [mindId]: [makeMessage([makeTextBlock('existing')])] },
      };
      const state = appReducer(stateWithMsgs, { type: 'A2A_INCOMING', payload: a2aPayload() });
      expect(state.messagesByMind[mindId]).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // streamingByMind tracking
  // -------------------------------------------------------------------------

  describe('streamingByMind', () => {
    it('ADD_ASSISTANT_MESSAGE sets streamingByMind for active mind', () => {
      const state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
      expect(state.streamingByMind[mindId]).toBe(true);
    });

    it('CHAT_EVENT done clears streamingByMind for that mind', () => {
      let state = appReducer(withActiveMind, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
      state = appReducer(state, { type: 'CHAT_EVENT', payload: { mindId, messageId: 'a1', event: makeChatEvent('done') } });
      expect(state.streamingByMind[mindId]).toBe(false);
    });

    it('NEW_CONVERSATION clears streamingByMind for active mind', () => {
      const prev = { ...withActiveMind, streamingByMind: { [mindId]: true }, isStreaming: true };
      const state = appReducer(prev, { type: 'NEW_CONVERSATION' });
      expect(state.streamingByMind[mindId]).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Task tracking
  // -------------------------------------------------------------------------

  describe('Task tracking', () => {
    const makeTaskStatus = (state: Task['status']['state']): TaskStatus => ({
      state,
      timestamp: new Date().toISOString(),
    });

    const makeTask = (overrides?: Partial<Task>): Task => ({
      id: 'task-1',
      contextId: 'ctx-1',
      status: makeTaskStatus('submitted'),
      ...overrides,
    });

    const makeArtifact = (overrides?: Partial<Artifact>): Artifact => ({
      artifactId: 'art-1',
      parts: [{ text: 'result data', mediaType: 'text/plain' }],
      ...overrides,
    });

    it('initial state has empty tasksByMind', () => {
      expect(initialState.tasksByMind).toEqual({});
    });

    it('TASK_STATUS_UPDATE adds new task to state', () => {
      const state = appReducer(initialState, {
        type: 'TASK_STATUS_UPDATE',
        payload: {
          taskId: 'task-1',
          contextId: 'ctx-1',
          status: makeTaskStatus('submitted'),
          targetMindId: mindId,
        },
      });
      expect(state.tasksByMind[mindId]).toHaveLength(1);
      expect(state.tasksByMind[mindId][0]).toMatchObject({
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'submitted' },
      });
    });

    it('TASK_STATUS_UPDATE updates existing task status', () => {
      const stateWithTask: AppState = {
        ...initialState,
        tasksByMind: { [mindId]: [makeTask({ id: 'task-1', status: makeTaskStatus('submitted') })] },
      };
      const state = appReducer(stateWithTask, {
        type: 'TASK_STATUS_UPDATE',
        payload: {
          taskId: 'task-1',
          contextId: 'ctx-1',
          status: makeTaskStatus('working'),
          targetMindId: mindId,
        },
      });
      expect(state.tasksByMind[mindId]).toHaveLength(1);
      expect(state.tasksByMind[mindId][0].status.state).toBe('working');
    });

    it('TASK_ARTIFACT_UPDATE adds artifact to existing task', () => {
      const stateWithTask: AppState = {
        ...initialState,
        tasksByMind: { [mindId]: [makeTask({ id: 'task-1' })] },
      };
      const artifact = makeArtifact({ artifactId: 'art-1' });
      const state = appReducer(stateWithTask, {
        type: 'TASK_ARTIFACT_UPDATE',
        payload: {
          taskId: 'task-1',
          contextId: 'ctx-1',
          artifact,
          targetMindId: mindId,
        },
      });
      expect(state.tasksByMind[mindId][0].artifacts).toHaveLength(1);
      const artifacts = state.tasksByMind[mindId][0].artifacts;
      if (!artifacts) throw new Error('expected artifacts');
      expect(artifacts[0].artifactId).toBe('art-1');
    });

    it('TASK_ARTIFACT_UPDATE for unknown task is no-op', () => {
      const state = appReducer(initialState, {
        type: 'TASK_ARTIFACT_UPDATE',
        payload: {
          taskId: 'nonexistent',
          contextId: 'ctx-1',
          artifact: makeArtifact(),
          targetMindId: mindId,
        },
      });
      expect(state.tasksByMind[mindId]).toBeUndefined();
    });

    it('tasks grouped by target mind', () => {
      let state = appReducer(initialState, {
        type: 'TASK_STATUS_UPDATE',
        payload: { taskId: 'task-a', contextId: 'ctx-a', status: makeTaskStatus('submitted'), targetMindId: 'mind-1' },
      });
      state = appReducer(state, {
        type: 'TASK_STATUS_UPDATE',
        payload: { taskId: 'task-b', contextId: 'ctx-b', status: makeTaskStatus('working'), targetMindId: 'mind-2' },
      });
      expect(state.tasksByMind['mind-1']).toHaveLength(1);
      expect(state.tasksByMind['mind-2']).toHaveLength(1);
      expect(state.tasksByMind['mind-1'][0].id).toBe('task-a');
      expect(state.tasksByMind['mind-2'][0].id).toBe('task-b');
    });

    it('multiple tasks per mind tracked correctly', () => {
      let state = appReducer(initialState, {
        type: 'TASK_STATUS_UPDATE',
        payload: { taskId: 'task-1', contextId: 'ctx-1', status: makeTaskStatus('submitted'), targetMindId: mindId },
      });
      state = appReducer(state, {
        type: 'TASK_STATUS_UPDATE',
        payload: { taskId: 'task-2', contextId: 'ctx-2', status: makeTaskStatus('working'), targetMindId: mindId },
      });
      expect(state.tasksByMind[mindId]).toHaveLength(2);
      expect(state.tasksByMind[mindId][0].id).toBe('task-1');
      expect(state.tasksByMind[mindId][1].id).toBe('task-2');
    });

    it('terminal task state persists (not overwritten by stale update)', () => {
      const stateWithTerminal: AppState = {
        ...initialState,
        tasksByMind: { [mindId]: [makeTask({ id: 'task-1', status: makeTaskStatus('completed') })] },
      };
      const state = appReducer(stateWithTerminal, {
        type: 'TASK_STATUS_UPDATE',
        payload: {
          taskId: 'task-1',
          contextId: 'ctx-1',
          status: makeTaskStatus('working'),
          targetMindId: mindId,
        },
      });
      expect(state.tasksByMind[mindId][0].status.state).toBe('completed');
    });
  });
});

// ---------------------------------------------------------------------------
// Chatroom actions
// ---------------------------------------------------------------------------

const makeChatroomMessage = (overrides?: Partial<ChatroomMessage>): ChatroomMessage => ({
  id: 'msg-1',
  role: 'user',
  blocks: [{ type: 'text', content: 'hello' }],
  timestamp: Date.now(),
  sender: { mindId: 'user', name: 'You' },
  roundId: 'round-1',
  ...overrides,
});

describe('appReducer — chatroom actions', () => {
  it('SET_CHATROOM_HISTORY sets chatroomMessages from payload', () => {
    const msgs = [makeChatroomMessage({ id: 'h1' }), makeChatroomMessage({ id: 'h2' })];
    const state = appReducer(initialState, { type: 'SET_CHATROOM_HISTORY', payload: msgs });
    expect(state.chatroomMessages).toEqual(msgs);
  });

  it('CHATROOM_USER_MESSAGE appends user message with sender and roundId', () => {
    const msg = makeChatroomMessage({ id: 'u1', sender: { mindId: 'user', name: 'You' }, roundId: 'r1' });
    const state = appReducer(initialState, { type: 'CHATROOM_USER_MESSAGE', payload: msg });
    expect(state.chatroomMessages).toHaveLength(1);
    expect(state.chatroomMessages[0]).toMatchObject({ id: 'u1', sender: { mindId: 'user', name: 'You' }, roundId: 'r1' });
  });

  it('CHATROOM_AGENT_MESSAGE creates empty streaming assistant message with sender', () => {
    const state = appReducer(initialState, {
      type: 'CHATROOM_AGENT_MESSAGE',
      payload: { messageId: 'a1', mindId: 'mind-1', mindName: 'Agent A', roundId: 'r1', timestamp: 1000 },
    });
    expect(state.chatroomMessages).toHaveLength(1);
    const msg = state.chatroomMessages[0];
    expect(msg.id).toBe('a1');
    expect(msg.role).toBe('assistant');
    expect(msg.blocks).toEqual([]);
    expect(msg.isStreaming).toBe(true);
    expect(msg.sender).toEqual({ mindId: 'mind-1', name: 'Agent A' });
    expect(msg.roundId).toBe('r1');
    expect(state.chatroomStreamingByMind['mind-1']).toBe(true);
  });

  it('CHATROOM_EVENT chunk appends text to correct agent message', () => {
    const base: AppState = {
      ...initialState,
      chatroomMessages: [
        makeChatroomMessage({ id: 'a1', role: 'assistant', blocks: [], sender: { mindId: 'mind-1', name: 'Agent A' } }),
      ],
      chatroomStreamingByMind: { 'mind-1': true },
    };
    const state = appReducer(base, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-1', mindName: 'Agent A', messageId: 'a1', roundId: 'r1', event: { type: 'chunk', content: 'hello' } },
    });
    expect(state.chatroomMessages[0].blocks).toHaveLength(1);
    expect(state.chatroomMessages[0].blocks[0]).toMatchObject({ type: 'text', content: 'hello' });
  });

  it('CHATROOM_EVENT done sets chatroomStreamingByMind[mindId] to false', () => {
    const base: AppState = {
      ...initialState,
      chatroomMessages: [
        makeChatroomMessage({ id: 'a1', role: 'assistant', blocks: [], isStreaming: true, sender: { mindId: 'mind-1', name: 'Agent A' } }),
      ],
      chatroomStreamingByMind: { 'mind-1': true },
    };
    const state = appReducer(base, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-1', mindName: 'Agent A', messageId: 'a1', roundId: 'r1', event: { type: 'done' } },
    });
    expect(state.chatroomStreamingByMind['mind-1']).toBe(false);
    expect(state.chatroomMessages[0].isStreaming).toBe(false);
  });

  it('CHATROOM_EVENT error sets streaming false and appends error text', () => {
    const base: AppState = {
      ...initialState,
      chatroomMessages: [
        makeChatroomMessage({ id: 'a1', role: 'assistant', blocks: [], isStreaming: true, sender: { mindId: 'mind-1', name: 'Agent A' } }),
      ],
      chatroomStreamingByMind: { 'mind-1': true },
    };
    const state = appReducer(base, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-1', mindName: 'Agent A', messageId: 'a1', roundId: 'r1', event: { type: 'error', message: 'boom' } },
    });
    expect(state.chatroomStreamingByMind['mind-1']).toBe(false);
    expect(state.chatroomMessages[0].isStreaming).toBe(false);
    const textBlocks = state.chatroomMessages[0].blocks.filter(b => b.type === 'text');
    expect(textBlocks.some(b => b.type === 'text' && b.content.includes('boom'))).toBe(true);
  });

  it('multi-agent interleave — two agents streaming simultaneously, events update correct messages', () => {
    const base: AppState = {
      ...initialState,
      chatroomMessages: [
        makeChatroomMessage({ id: 'a1', role: 'assistant', blocks: [], isStreaming: true, sender: { mindId: 'mind-1', name: 'Agent A' }, roundId: 'r1' }),
        makeChatroomMessage({ id: 'a2', role: 'assistant', blocks: [], isStreaming: true, sender: { mindId: 'mind-2', name: 'Agent B' }, roundId: 'r1' }),
      ],
      chatroomStreamingByMind: { 'mind-1': true, 'mind-2': true },
    };

    // Agent A gets a chunk
    let state = appReducer(base, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-1', mindName: 'Agent A', messageId: 'a1', roundId: 'r1', event: { type: 'chunk', content: 'alpha' } },
    });
    // Agent B gets a chunk
    state = appReducer(state, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-2', mindName: 'Agent B', messageId: 'a2', roundId: 'r1', event: { type: 'chunk', content: 'beta' } },
    });

    expect(state.chatroomMessages[0].blocks[0]).toMatchObject({ type: 'text', content: 'alpha' });
    expect(state.chatroomMessages[1].blocks[0]).toMatchObject({ type: 'text', content: 'beta' });

    // Agent A finishes
    state = appReducer(state, {
      type: 'CHATROOM_EVENT',
      payload: { mindId: 'mind-1', mindName: 'Agent A', messageId: 'a1', roundId: 'r1', event: { type: 'done' } },
    });
    expect(state.chatroomStreamingByMind['mind-1']).toBe(false);
    expect(state.chatroomStreamingByMind['mind-2']).toBe(true);
  });

  it('CHATROOM_CLEAR resets all chatroom state', () => {
    const base: AppState = {
      ...initialState,
      chatroomMessages: [makeChatroomMessage()],
      chatroomStreamingByMind: { 'mind-1': true },
    };
    const state = appReducer(base, { type: 'CHATROOM_CLEAR' });
    expect(state.chatroomMessages).toEqual([]);
    expect(state.chatroomStreamingByMind).toEqual({});
  });
});
