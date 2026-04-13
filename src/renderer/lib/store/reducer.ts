import type { ChatMessage, ChatEvent, ContentBlock } from '../../../shared/types';
import type { Task, TaskState } from '../../../shared/a2a-types';
import type { ChatroomMessage } from '../../../shared/chatroom-types';
import type { AppState, AppAction } from './state';

/** Extract plain text from content blocks (for search, accessibility, etc.) */
export function getPlainContent(message: ChatMessage): string {
  return message.blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.content)
    .join('');
}

export function handleChatEvent(messages: ChatMessage[], messageId: string, event: ChatEvent): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;

    const blocks = [...m.blocks];

    switch (event.type) {
      case 'chunk': {
        // Append to last text block, or create one
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content, sdkMessageId: event.sdkMessageId };
        } else {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
        }
        return { ...m, blocks };
      }

      case 'tool_start': {
        blocks.push({
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'running',
          arguments: event.args,
          parentToolCallId: event.parentToolCallId,
        });
        return { ...m, blocks };
      }

      case 'tool_progress': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.message + '\n' };
        }
        return { ...m, blocks };
      }

      case 'tool_output': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.output };
        }
        return { ...m, blocks };
      }

      case 'tool_done': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = {
            ...block,
            status: event.success ? 'done' : 'error',
            ...(event.result && { output: (block.output || '') + event.result }),
            ...(event.error && { error: event.error }),
          };
        }
        return { ...m, blocks };
      }

      case 'reasoning': {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'reasoning' && last.reasoningId === event.reasoningId) {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content };
        } else {
          blocks.push({ type: 'reasoning', reasoningId: event.reasoningId, content: event.content });
        }
        return { ...m, blocks };
      }

      case 'message_final': {
        // Reconciliation: if no text blocks exist yet, create one
        const hasText = blocks.some(b => b.type === 'text');
        if (!hasText && event.content) {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
          return { ...m, blocks };
        }
        return m;
      }

      case 'reconnecting':
        return m; // No-op in blocks — UI uses isStreaming to show indicator

      case 'done':
        return { ...m, isStreaming: false };

      case 'error':
        return {
          ...m,
          isStreaming: false,
          blocks: [...blocks, { type: 'text' as const, content: `Error: ${event.message}` }],
        };

      default:
        return m;
    }
  });
}

export function appReducer(state: AppState, action: AppAction): AppState {
  // Helper: get current mind's messages
  const activeMsgs = () => state.activeMindId ? (state.messagesByMind[state.activeMindId] ?? []) : [];
  const setActiveMsgs = (msgs: ChatMessage[]) => {
    if (!state.activeMindId) return state.messagesByMind;
    return { ...state.messagesByMind, [state.activeMindId]: msgs };
  };

  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messagesByMind: setActiveMsgs([...activeMsgs(), {
          id: action.payload.id,
          role: 'user',
          blocks: [{ type: 'text', content: action.payload.content }],
          timestamp: action.payload.timestamp,
        }]),
      };

    case 'ADD_ASSISTANT_MESSAGE':
      return {
        ...state,
        isStreaming: true,
        streamingByMind: state.activeMindId
          ? { ...state.streamingByMind, [state.activeMindId]: true }
          : state.streamingByMind,
        messagesByMind: setActiveMsgs([...activeMsgs(), {
          id: action.payload.id,
          role: 'assistant',
          blocks: [],
          timestamp: action.payload.timestamp,
          isStreaming: true,
        }]),
      };

    case 'CHAT_EVENT': {
      const { mindId, messageId, event } = action.payload;
      const mindMsgs = state.messagesByMind[mindId] ?? [];
      const newMessages = handleChatEvent(mindMsgs, messageId, event);
      const isDone = event.type === 'done' || event.type === 'error';
      const newStreamingByMind = isDone
        ? { ...state.streamingByMind, [mindId]: false }
        : state.streamingByMind;
      return {
        ...state,
        messagesByMind: { ...state.messagesByMind, [mindId]: newMessages },
        isStreaming: isDone ? false : state.isStreaming,
        streamingByMind: newStreamingByMind,
      };
    }

    case 'SET_MINDS':
      return { ...state, minds: action.payload };

    case 'SET_ACTIVE_MIND':
      return { ...state, activeMindId: action.payload, isStreaming: false, streamingByMind: state.streamingByMind };

    case 'ADD_MIND': {
      const exists = state.minds.some(m => m.mindId === action.payload.mindId);
      if (exists) return state;
      return {
        ...state,
        minds: [...state.minds, action.payload],
        activeMindId: state.activeMindId ?? action.payload.mindId,
      };
    }

    case 'REMOVE_MIND': {
      const newMinds = state.minds.filter(m => m.mindId !== action.payload);
      const newMsgsByMind = { ...state.messagesByMind };
      delete newMsgsByMind[action.payload];
      const newActive = state.activeMindId === action.payload
        ? (newMinds.length > 0 ? newMinds[0].mindId : null)
        : state.activeMindId;
      return {
        ...state,
        minds: newMinds,
        activeMindId: newActive,
        messagesByMind: newMsgsByMind,
        showLanding: newMinds.length === 0,
      };
    }

    case 'SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.payload };

    case 'SET_SELECTED_MODEL':
      if (action.payload) {
        localStorage.setItem('chamber:selectedModel', action.payload);
      } else {
        localStorage.removeItem('chamber:selectedModel');
      }
      return { ...state, selectedModel: action.payload };

    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.payload };

    case 'SET_DISCOVERED_VIEWS':
      return { ...state, discoveredViews: action.payload };

    case 'SHOW_LANDING':
      return { ...state, showLanding: true };

    case 'HIDE_LANDING':
      return { ...state, showLanding: false };

    case 'MINDS_CHECKED':
      return { ...state, mindsChecked: true };

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messagesByMind: state.activeMindId
          ? { ...state.messagesByMind, [state.activeMindId]: [] }
          : state.messagesByMind,
      };

    case 'NEW_CONVERSATION':
      return {
        ...state,
        messagesByMind: state.activeMindId
          ? { ...state.messagesByMind, [state.activeMindId]: [] }
          : state.messagesByMind,
        isStreaming: false,
        streamingByMind: state.activeMindId
          ? { ...state.streamingByMind, [state.activeMindId]: false }
          : state.streamingByMind,
      };

    case 'A2A_INCOMING': {
      const { targetMindId, message, replyMessageId } = action.payload;
      const targetMsgs = state.messagesByMind[targetMindId] ?? [];
      const senderMessage: ChatMessage = {
        id: message.messageId ?? `a2a-${Date.now()}`,
        role: 'user',
        blocks: (message.parts ?? []).map((p) => ({
          type: 'text' as const,
          content: p.text ?? '',
        })),
        timestamp: Date.now(),
        sender: {
          mindId: (message.metadata?.fromId as string) ?? 'unknown',
          name: (message.metadata?.fromName as string) ?? 'Unknown Agent',
        },
      };
      const replyPlaceholder: ChatMessage = {
        id: replyMessageId,
        role: 'assistant',
        blocks: [],
        timestamp: Date.now(),
        isStreaming: true,
      };
      const isActiveMind = targetMindId === state.activeMindId;
      return {
        ...state,
        messagesByMind: {
          ...state.messagesByMind,
          [targetMindId]: [...targetMsgs, senderMessage, replyPlaceholder],
        },
        streamingByMind: { ...state.streamingByMind, [targetMindId]: true },
        isStreaming: isActiveMind ? true : state.isStreaming,
      };
    }

    case 'TASK_STATUS_UPDATE': {
      const TERMINAL_STATES: Set<TaskState> = new Set(['completed', 'failed', 'canceled', 'rejected']);
      const { taskId, targetMindId, status, contextId } = action.payload;
      const existingTasks = state.tasksByMind[targetMindId] ?? [];
      const idx = existingTasks.findIndex(t => t.id === taskId);
      let updatedTasks: Task[];
      if (idx >= 0) {
        const existing = existingTasks[idx];
        // Don't overwrite terminal tasks with non-terminal status
        if (TERMINAL_STATES.has(existing.status.state) && !TERMINAL_STATES.has(status.state)) {
          return state;
        }
        updatedTasks = existingTasks.map((t, i) => i === idx ? { ...t, status } : t);
      } else {
        const newTask: Task = { id: taskId, contextId, status };
        updatedTasks = [...existingTasks, newTask];
      }
      return {
        ...state,
        tasksByMind: { ...state.tasksByMind, [targetMindId]: updatedTasks },
      };
    }

    case 'TASK_ARTIFACT_UPDATE': {
      const { taskId, targetMindId, artifact } = action.payload;
      const tasks = state.tasksByMind[targetMindId];
      if (!tasks) return state;
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx < 0) return state;
      const task = tasks[idx];
      const updatedTask: Task = { ...task, artifacts: [...(task.artifacts ?? []), artifact] };
      const updatedTasks = tasks.map((t, i) => i === idx ? updatedTask : t);
      return {
        ...state,
        tasksByMind: { ...state.tasksByMind, [targetMindId]: updatedTasks },
      };
    }

    case 'SET_CHATROOM_HISTORY':
      return { ...state, chatroomMessages: action.payload };

    case 'CHATROOM_USER_MESSAGE':
      return { ...state, chatroomMessages: [...state.chatroomMessages, action.payload] };

    case 'CHATROOM_AGENT_MESSAGE': {
      const { messageId, mindId, mindName, roundId, timestamp } = action.payload;
      const agentMsg: ChatroomMessage = {
        id: messageId,
        role: 'assistant',
        blocks: [],
        timestamp,
        isStreaming: true,
        sender: { mindId, name: mindName },
        roundId,
      };
      return {
        ...state,
        chatroomMessages: [...state.chatroomMessages, agentMsg],
        chatroomStreamingByMind: { ...state.chatroomStreamingByMind, [mindId]: true },
      };
    }

    case 'CHATROOM_EVENT': {
      const { mindId, mindName, messageId, roundId, event } = action.payload;
      let messages = state.chatroomMessages;

      // Auto-create placeholder if this is the first event for an unknown message
      const exists = messages.some(m => m.id === messageId);
      if (!exists) {
        const placeholder: ChatroomMessage = {
          id: messageId,
          role: 'assistant',
          blocks: [],
          timestamp: Date.now(),
          isStreaming: true,
          sender: { mindId, name: mindName },
          roundId,
        };
        messages = [...messages, placeholder];
      }

      const newMessages = handleChatEvent(messages, messageId, event);
      const isDone = event.type === 'done' || event.type === 'error';
      return {
        ...state,
        chatroomMessages: newMessages as ChatroomMessage[],
        chatroomStreamingByMind: isDone
          ? { ...state.chatroomStreamingByMind, [mindId]: false }
          : { ...state.chatroomStreamingByMind, [mindId]: true },
      };
    }

    case 'CHATROOM_CLEAR':
      return { ...state, chatroomMessages: [], chatroomStreamingByMind: {} };

    default:
      return state;
  }
}
