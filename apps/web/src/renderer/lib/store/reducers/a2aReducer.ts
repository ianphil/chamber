import type { ChatMessage } from '@chamber/shared/types';
import type { Task, TaskState } from '@chamber/shared/a2a-types';
import type { AppState, AppAction } from '../state';
import { nonEmptyString } from './helpers';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']);

function a2aIncoming(state: AppState, action: Extract<AppAction, { type: 'A2A_INCOMING' }>): Partial<AppState> {
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
      mindId: nonEmptyString(message.metadata?.fromId, 'unknown'),
      name: nonEmptyString(message.metadata?.fromName, 'Unknown Agent'),
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
    messagesByMind: {
      ...state.messagesByMind,
      [targetMindId]: [...targetMsgs, senderMessage, replyPlaceholder],
    },
    streamingByMind: { ...state.streamingByMind, [targetMindId]: true },
    isStreaming: isActiveMind ? true : state.isStreaming,
  };
}

function taskStatusUpdate(
  state: AppState,
  action: Extract<AppAction, { type: 'TASK_STATUS_UPDATE' }>,
): Partial<AppState> | AppState {
  const { taskId, targetMindId, status, contextId } = action.payload;
  const existingTasks = state.tasksByMind[targetMindId] ?? [];
  const idx = existingTasks.findIndex((t) => t.id === taskId);
  let updatedTasks: Task[];
  if (idx >= 0) {
    const existing = existingTasks[idx];
    if (TERMINAL_TASK_STATES.has(existing.status.state) && !TERMINAL_TASK_STATES.has(status.state)) {
      return state;
    }
    updatedTasks = existingTasks.map((t, i) => (i === idx ? { ...t, status } : t));
  } else {
    const newTask: Task = { id: taskId, contextId, status };
    updatedTasks = [...existingTasks, newTask];
  }
  return {
    tasksByMind: { ...state.tasksByMind, [targetMindId]: updatedTasks },
  };
}

function taskArtifactUpdate(
  state: AppState,
  action: Extract<AppAction, { type: 'TASK_ARTIFACT_UPDATE' }>,
): Partial<AppState> | AppState {
  const { taskId, targetMindId, artifact } = action.payload;
  const tasks = state.tasksByMind[targetMindId];
  if (!tasks) return state;
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return state;
  const task = tasks[idx];
  const updatedTask: Task = { ...task, artifacts: [...(task.artifacts ?? []), artifact] };
  const updatedTasks = tasks.map((t, i) => (i === idx ? updatedTask : t));
  return {
    tasksByMind: { ...state.tasksByMind, [targetMindId]: updatedTasks },
  };
}

export const a2aHandlers: {
  A2A_INCOMING: Handler<'A2A_INCOMING'>;
  TASK_STATUS_UPDATE: Handler<'TASK_STATUS_UPDATE'>;
  TASK_ARTIFACT_UPDATE: Handler<'TASK_ARTIFACT_UPDATE'>;
} = {
  A2A_INCOMING: a2aIncoming,
  TASK_STATUS_UPDATE: taskStatusUpdate,
  TASK_ARTIFACT_UPDATE: taskArtifactUpdate,
};
