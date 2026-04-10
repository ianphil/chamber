/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { handleChatEvent, appReducer, initialState } from '.';
import type { AppState, AppAction } from '.';
import type { ChatMessage, ChatEvent } from '../../../shared/types';
import {
  makeMessage,
  makeTextBlock,
  makeToolCallBlock,
  makeReasoningBlock,
  makeChatEvent,
  defaultAgentStatus,
  connectedAgentStatus,
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

    it('is a no-op when text blocks already exist', () => {
      const initial = [makeMessage([makeTextBlock('existing')], { id: 'msg-1' })];
      const msgs = handleChatEvent(initial, 'msg-1', makeChatEvent('message_final', { sdkMessageId: 'sdk-1', content: 'Final' }));
      expect(msgs[0].blocks).toHaveLength(1);
      expect(msgs[0].blocks[0]).toMatchObject({ content: 'existing' });
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
  it('ADD_USER_MESSAGE adds a user message with text block', () => {
    const state = appReducer(initialState, { type: 'ADD_USER_MESSAGE', payload: { id: 'u1', content: 'Hello', timestamp: 1000 } });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'Hello' }] });
  });

  it('ADD_ASSISTANT_MESSAGE adds a streaming assistant message', () => {
    const state = appReducer(initialState, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'a1', role: 'assistant', blocks: [], isStreaming: true });
    expect(state.isStreaming).toBe(true);
  });

  it('CHAT_EVENT delegates to handleChatEvent', () => {
    let state = appReducer(initialState, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { messageId: 'a1', event: makeChatEvent('chunk', { content: 'Hi' }) } });
    expect(state.messages[0].blocks[0]).toMatchObject({ type: 'text', content: 'Hi' });
  });

  it('CHAT_EVENT with done sets isStreaming false', () => {
    let state = appReducer(initialState, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { messageId: 'a1', event: makeChatEvent('done') } });
    expect(state.isStreaming).toBe(false);
  });

  it('CHAT_EVENT with error sets isStreaming false', () => {
    let state = appReducer(initialState, { type: 'ADD_ASSISTANT_MESSAGE', payload: { id: 'a1', timestamp: 1000 } });
    state = appReducer(state, { type: 'CHAT_EVENT', payload: { messageId: 'a1', event: makeChatEvent('error', { message: 'fail' }) } });
    expect(state.isStreaming).toBe(false);
  });

  it('SET_AGENT_STATUS updates agentStatus', () => {
    const status = connectedAgentStatus();
    const state = appReducer(initialState, { type: 'SET_AGENT_STATUS', payload: status });
    expect(state.agentStatus).toEqual(status);
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

  it('CLEAR_MESSAGES empties messages', () => {
    const withMsgs = { ...initialState, messages: [makeMessage([makeTextBlock('hi')])] };
    const state = appReducer(withMsgs, { type: 'CLEAR_MESSAGES' });
    expect(state.messages).toHaveLength(0);
  });

  it('NEW_CONVERSATION resets messages, streaming, and generates new conversationId', () => {
    const prev = { ...initialState, messages: [makeMessage([])], isStreaming: true, conversationId: 'old' };
    const state = appReducer(prev, { type: 'NEW_CONVERSATION' });
    expect(state.messages).toHaveLength(0);
    expect(state.isStreaming).toBe(false);
    expect(state.conversationId).not.toBe('old');
    expect(state.conversationId).toMatch(/^conv-/);
  });

  it('unknown action returns state unchanged', () => {
    const state = appReducer(initialState, { type: 'BOGUS' } as unknown as AppAction);
    expect(state).toBe(initialState);
  });
});
