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
  return {
    messagesByMind: {
      ...state.messagesByMind,
      [targetMindId]: [...targetMsgs, senderMessage, replyPlaceholder],
    },
    a2aStreamingByMind: { ...state.a2aStreamingByMind, [targetMindId]: true },
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
  const isTerminal = TERMINAL_TASK_STATES.has(status.state);
  return {
    tasksByMind: { ...state.tasksByMind, [targetMindId]: updatedTasks },
    ...(isTerminal
      ? { a2aStreamingByMind: { ...state.a2aStreamingByMind, [targetMindId]: false } }
      : {}),
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

function setPendingApprovals(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_PENDING_A2A_APPROVALS' }>,
): Partial<AppState> {
  const pendingA2AApprovals = action.payload.filter((approval) => approval.state === 'pending');
  const pendingIds = new Set(pendingA2AApprovals.map((approval) => approval.id));
  return {
    pendingA2AApprovals,
    selectedA2AApprovalId: state.selectedA2AApprovalId && pendingIds.has(state.selectedA2AApprovalId)
      ? state.selectedA2AApprovalId
      : null,
    a2aApprovalAction: state.a2aApprovalAction && pendingIds.has(state.a2aApprovalAction.id)
      ? state.a2aApprovalAction
      : null,
    a2aApprovalError: state.a2aApprovalError && pendingIds.has(state.a2aApprovalError.id)
      ? state.a2aApprovalError
      : null,
  };
}

function applyApprovalState(
  state: AppState,
  action: Extract<AppAction, { type: 'APPLY_A2A_APPROVAL_STATE' }>,
): Partial<AppState> {
  const existing = state.pendingA2AApprovals.filter((approval) => approval.id !== action.payload.id);
  const pendingA2AApprovals = action.payload.state === 'pending'
    ? [...existing, action.payload]
    : existing;
  const remainsPending = action.payload.state === 'pending';
  return {
    pendingA2AApprovals,
    selectedA2AApprovalId: state.selectedA2AApprovalId === action.payload.id && !remainsPending
      ? null
      : state.selectedA2AApprovalId,
    a2aApprovalAction: state.a2aApprovalAction?.id === action.payload.id
      ? null
      : state.a2aApprovalAction,
    a2aApprovalError: state.a2aApprovalError?.id === action.payload.id
      ? null
      : state.a2aApprovalError,
  };
}

function selectApproval(
  state: AppState,
  action: Extract<AppAction, { type: 'SELECT_A2A_APPROVAL' }>,
): Partial<AppState> {
  const selectedA2AApprovalId = action.payload
    && state.pendingA2AApprovals.some((approval) => approval.id === action.payload)
    ? action.payload
    : null;
  return {
    selectedA2AApprovalId,
    a2aApprovalError: selectedA2AApprovalId === state.a2aApprovalError?.id
      ? state.a2aApprovalError
      : null,
  };
}

function approvalActionStarted(
  _state: AppState,
  action: Extract<AppAction, { type: 'A2A_APPROVAL_ACTION_STARTED' }>,
): Partial<AppState> {
  return {
    a2aApprovalAction: action.payload,
    a2aApprovalError: null,
  };
}

function approvalActionCompleted(
  state: AppState,
  action: Extract<AppAction, { type: 'A2A_APPROVAL_ACTION_COMPLETED' }>,
): Partial<AppState> | AppState {
  if (state.a2aApprovalAction?.id !== action.payload.id) return state;
  return { a2aApprovalAction: null };
}

function approvalActionFailed(
  state: AppState,
  action: Extract<AppAction, { type: 'A2A_APPROVAL_ACTION_FAILED' }>,
): Partial<AppState> | AppState {
  if (state.a2aApprovalAction?.id !== action.payload.id) return state;
  return {
    a2aApprovalAction: null,
    a2aApprovalError: action.payload,
  };
}

export const a2aHandlers: {
  A2A_INCOMING: Handler<'A2A_INCOMING'>;
  TASK_STATUS_UPDATE: Handler<'TASK_STATUS_UPDATE'>;
  TASK_ARTIFACT_UPDATE: Handler<'TASK_ARTIFACT_UPDATE'>;
  SET_PENDING_A2A_APPROVALS: Handler<'SET_PENDING_A2A_APPROVALS'>;
  APPLY_A2A_APPROVAL_STATE: Handler<'APPLY_A2A_APPROVAL_STATE'>;
  SELECT_A2A_APPROVAL: Handler<'SELECT_A2A_APPROVAL'>;
  A2A_APPROVAL_ACTION_STARTED: Handler<'A2A_APPROVAL_ACTION_STARTED'>;
  A2A_APPROVAL_ACTION_COMPLETED: Handler<'A2A_APPROVAL_ACTION_COMPLETED'>;
  A2A_APPROVAL_ACTION_FAILED: Handler<'A2A_APPROVAL_ACTION_FAILED'>;
} = {
  A2A_INCOMING: a2aIncoming,
  TASK_STATUS_UPDATE: taskStatusUpdate,
  TASK_ARTIFACT_UPDATE: taskArtifactUpdate,
  SET_PENDING_A2A_APPROVALS: setPendingApprovals,
  APPLY_A2A_APPROVAL_STATE: applyApprovalState,
  SELECT_A2A_APPROVAL: selectApproval,
  A2A_APPROVAL_ACTION_STARTED: approvalActionStarted,
  A2A_APPROVAL_ACTION_COMPLETED: approvalActionCompleted,
  A2A_APPROVAL_ACTION_FAILED: approvalActionFailed,
};
