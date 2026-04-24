import type { ChatMessage, ChatEvent, ContentBlock } from '../../../shared/types';
import type { Task, TaskState } from '../../../shared/a2a-types';
import type { ChatroomMessage, TaskLedgerItem } from '../../../shared/chatroom-types';
import { isOrchestrationEvent } from '../../../shared/chatroom-types';
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
        // Reconciliation: add text if this sdkMessageId hasn't been streamed via chunks
        const hasThisMessage = blocks.some(b => b.type === 'text' && b.sdkMessageId === event.sdkMessageId);
        if (!hasThisMessage && event.content) {
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
    case 'ADD_USER_MESSAGE': {
      const textBlock: ContentBlock = { type: 'text', content: action.payload.content };
      const blocks: ContentBlock[] = action.payload.images && action.payload.images.length > 0
        ? [...action.payload.images, textBlock]
        : [textBlock];
      return {
        ...state,
        messagesByMind: setActiveMsgs([...activeMsgs(), {
          id: action.payload.id,
          role: 'user',
          blocks,
          timestamp: action.payload.timestamp,
        }]),
      };
    }

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

    case 'ACCOUNT_SWITCH_STARTED':
      return {
        ...state,
        runtimePhase: 'switching-account',
        switchingAccountLogin: action.payload.login,
        showLanding: false,
      };

    case 'ACCOUNT_SWITCH_COMPLETED':
      return {
        ...state,
        runtimePhase: 'ready',
        switchingAccountLogin: null,
      };

    case 'LOGGED_OUT':
      return {
        ...state,
        runtimePhase: 'ready',
        switchingAccountLogin: null,
      };

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
        chatroomMessages: [],
        chatroomStreamingByMind: {},
        chatroomActiveSpeaker: null,
        chatroomTaskLedger: [],
        chatroomMetrics: null,
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
      return {
        ...state,
        chatroomMessages: [...state.chatroomMessages, action.payload],
        // Clear stale orchestration state from previous round
        chatroomActiveSpeaker: null,
        chatroomMetrics: null,
        chatroomTaskLedger: [],
      };

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

      // Orchestration events update the active speaker indicator
      if (isOrchestrationEvent(event)) {
        switch (event.type) {
          case 'orchestration:turn-start':
            return {
              ...state,
              chatroomActiveSpeaker: {
                mindId: event.data.speakerMindId ?? mindId,
                mindName: event.data.speaker ?? mindName,
                phase: 'speaking',
              },
            };

          case 'orchestration:moderator-decision':
            return {
              ...state,
              chatroomActiveSpeaker: {
                mindId,
                mindName,
                phase: 'moderating',
              },
            };

          case 'orchestration:synthesis':
            return {
              ...state,
              chatroomActiveSpeaker: {
                mindId,
                mindName,
                phase: 'synthesizing',
              },
            };

          case 'orchestration:convergence':
          case 'orchestration:handoff-terminated':
          case 'orchestration:magentic-terminated':
            return { ...state, chatroomActiveSpeaker: null };

          case 'orchestration:handoff':
            return {
              ...state,
              chatroomActiveSpeaker: {
                mindId: event.data.toMindId ?? mindId,
                mindName: event.data.to ?? mindName,
                phase: 'speaking',
              },
            };

          case 'orchestration:manager-plan':
          case 'orchestration:task-ledger-update':
            return {
              ...state,
              chatroomActiveSpeaker: {
                mindId,
                mindName,
                phase: 'moderating',
              },
              ...(event.type === 'orchestration:task-ledger-update' && event.data.ledger
                ? { chatroomTaskLedger: event.data.ledger as TaskLedgerItem[] }
                : {}),
            };

          case 'orchestration:metrics':
            return {
              ...state,
              chatroomMetrics: event.data as AppState['chatroomMetrics'],
            };

          case 'orchestration:approval-requested':
          case 'orchestration:approval-decided':
          default:
            return state;
        }
      }

      // At this point, event is a ChatEvent (not an OrchestrationEvent)
      const chatEvent = event as ChatEvent;

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

      const newMessages = handleChatEvent(messages, messageId, chatEvent);
      const isDone = chatEvent.type === 'done' || chatEvent.type === 'error';
      return {
        ...state,
        chatroomMessages: newMessages as ChatroomMessage[],
        chatroomStreamingByMind: isDone
          ? { ...state.chatroomStreamingByMind, [mindId]: false }
          : { ...state.chatroomStreamingByMind, [mindId]: true },
        // Clear active speaker when the active speaker finishes
        ...(isDone && state.chatroomActiveSpeaker?.mindId === mindId
          ? { chatroomActiveSpeaker: null }
          : {}),
      };
    }

    case 'CHATROOM_CLEAR':
      return { ...state, chatroomMessages: [], chatroomStreamingByMind: {}, chatroomActiveSpeaker: null, chatroomTaskLedger: [], chatroomMetrics: null };

    case 'SET_CHATROOM_TASK_LEDGER':
      return { ...state, chatroomTaskLedger: action.payload };

    case 'SET_ORCHESTRATION':
      return { ...state, chatroomOrchestration: action.payload };

    case 'SET_GROUP_CHAT_CONFIG':
      return { ...state, chatroomGroupChatConfig: action.payload };

    case 'SET_HANDOFF_CONFIG':
      return { ...state, chatroomHandoffConfig: action.payload };

    case 'SET_MAGENTIC_CONFIG':
      return { ...state, chatroomMagenticConfig: action.payload };

    case 'CHATROOM_ACTIVE_SPEAKER':
      return { ...state, chatroomActiveSpeaker: action.payload };

    default:
      return state;
  }
}
