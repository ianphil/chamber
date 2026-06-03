import { EventEmitter } from 'events';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Task as TTasksTask, TaskResult, TaskStatus, type Store } from '@ianphil/ttasks-ts';
import type { AgentCardRegistry } from './AgentCardRegistry';
import type { CopilotSession, UserInputHandler, UserInputResponse } from '../mind/types';
import { Logger } from '../logger';
import type {
  SendMessageRequest,
  Task as A2ATask,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  ListTasksResponse,
  Message,
} from './types';
import { isStaleSessionError } from '@chamber/shared/sessionErrors';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import { getSdkSessionErrorMessage } from '../sdk';
import type { TaskLedger } from '../ledger';

const log = Logger.create('TaskManager');

export interface TaskSessionFactory {
  createTaskSession(
    mindId: string,
    taskId: string,
    onUserInputRequest?: UserInputHandler,
  ): Promise<CopilotSession>;
}
import {
  generateTaskId,
  generateContextId,
  createTaskStatus,
  createArtifact,
  createTextMessage,
  serializeMessageToXml,
  generateMessageId,
} from './helpers';

const TERMINAL_STATES: Set<TaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export interface SendTaskRequest extends SendMessageRequest {
  onUserInputRequest?: UserInputHandler;
  suppressLedgerWrite?: boolean;
}

interface TaskManagerOptions {
  ledger?: TaskLedger;
  getLedgerForMind?: (mindId: string) => TaskLedger | undefined;
  ttasksStore?: Store;
  createTTasksStore?: (mindId: string) => Store | undefined;
}

export class TaskManager extends EventEmitter {
  static readonly MAX_COMPLETED_TASKS = 100;

  private tasks = new Map<string, A2ATask>();
  private sessions = new Map<string, CopilotSession>();
  private pendingInputs = new Map<string, (answer: UserInputResponse) => void>();
  private taskTargets = new Map<string, string>();
  private ttasksTasks = new Map<string, TTasksTask>();

  constructor(
    private readonly sessionFactory: TaskSessionFactory,
    private readonly agentCardRegistry: AgentCardRegistry,
    private readonly options: TaskManagerOptions = {},
  ) {
    super();
  }

  async sendTask(request: SendTaskRequest): Promise<A2ATask> {
    // 1. Resolve recipient
    const card =
      this.agentCardRegistry.getCard(request.recipient) ??
      this.agentCardRegistry.getCardByName(request.recipient);
    if (!card?.mindId) {
      throw new Error(`Unknown recipient: ${request.recipient}`);
    }
    const targetMindId = card.mindId;

    // 2-3. Generate ids
    const taskId = generateTaskId();
    const contextId = request.message.contextId || generateContextId();

    // 4. Create task
    const task: A2ATask = {
      id: taskId,
      contextId,
      status: createTaskStatus('TASK_STATE_SUBMITTED'),
      artifacts: [],
      history: [{ ...request.message, contextId, taskId }],
    };

    // 5. Store
    this.tasks.set(taskId, task);
    this.taskTargets.set(taskId, targetMindId);
    this.persistTTasksTask(task, targetMindId, request);
    if (!request.suppressLedgerWrite) {
      this.recordTaskLedgerSubmitted(task, targetMindId);
    }

    // 6. Emit submitted
    this.emitStatusUpdate(task);

    // 7. Snapshot the submitted state before async processing mutates it
    const snapshot: A2ATask = {
      ...task,
      status: { ...task.status },
      history: task.history ? [...task.history] : [],
      artifacts: task.artifacts ? [...task.artifacts] : [],
    };

    // 8. Async processing (fire-and-forget, deferred so caller gets submitted state)
    Promise.resolve().then(() =>
      this.processTask(task, targetMindId, request.message, request.onUserInputRequest)
        .catch((err) => {
          this.transitionState(task, 'TASK_STATE_FAILED');
          log.error(`Task ${taskId} failed:`, err);
        }),
    );

    // 9. Return snapshot at submitted state
    return snapshot;
  }

  getTask(id: string, historyLength?: number): A2ATask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (historyLength === undefined) return this.snapshotTask(task);

    return {
      ...this.snapshotTask(task),
      history: historyLength === 0 ? [] : (task.history ?? []).slice(-historyLength),
    };
  }

  // TODO: A2A pagination (page_size, page_token) not implemented — returns all matching tasks
  listTasks(filter?: { contextId?: string; status?: TaskState }): ListTasksResponse {
    let tasks = [...this.tasks.values()];

    if (filter?.contextId) {
      tasks = tasks.filter((t) => t.contextId === filter.contextId);
    }
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status.state === filter.status);
    }

    return {
      tasks: tasks.map(t => this.snapshotTask(t)),
      nextPageToken: '',
      pageSize: tasks.length,
      totalSize: tasks.length,
    };
  }

  cancelTask(id: string): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    if (TERMINAL_STATES.has(task.status.state)) {
      throw new Error(`Cannot cancel task in terminal state: ${task.status.state}`);
    }

    this.transitionState(task, 'TASK_STATE_CANCELED');

    // Abort session if exists
    const session = this.sessions.get(id);
    if (session) {
      // CopilotSession type may not expose abort() — use optional chaining
      (session as { abort?: () => Promise<void> }).abort?.().catch(() => { /* noop */ });
      this.sessions.delete(id);
    }

    return this.snapshotTask(task);
  }

  resumeTask(id: string, message: Message): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    if (task.status.state !== 'TASK_STATE_INPUT_REQUIRED') {
      throw new Error(`Task ${id} is not in input-required state (current: ${task.status.state})`);
    }

    const resolver = this.pendingInputs.get(id);
    if (!resolver) throw new Error(`No pending input request for task ${id}`);

    // Transition back to working
    task.status = createTaskStatus('TASK_STATE_WORKING');
    task.history = [...(task.history ?? []), message];
    this.emitStatusUpdate(task);

    // Resolve the pending callback with the user's answer
    const answerText = message.parts.find(p => p.text)?.text ?? '';
    resolver({ answer: answerText, wasFreeform: true });
    this.pendingInputs.delete(id);

    return this.snapshotTask(task);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private snapshotTask(task: A2ATask): A2ATask {
    return {
      ...task,
      status: { ...task.status },
      history: [...(task.history ?? [])],
      artifacts: [...(task.artifacts ?? [])],
    };
  }

  private async processTask(
    task: A2ATask,
    targetMindId: string,
    message: Message,
    onUserInputOverride?: UserInputHandler,
  ): Promise<void> {
    // a. Transition to working
    this.transitionState(task, 'TASK_STATE_WORKING');

    // b. Create isolated session with input-required callback
    const defaultOnUserInputRequest: UserInputHandler = async (request): Promise<UserInputResponse> => {
      const statusMessage = createTextMessage(targetMindId, request.question, { contextId: task.contextId });
      task.status = createTaskStatus('TASK_STATE_INPUT_REQUIRED', statusMessage);
      task.history = [...(task.history ?? []), statusMessage];
      this.emitStatusUpdate(task);

      return new Promise((resolve) => {
        this.pendingInputs.set(task.id, resolve);
      });
    };
    const onUserInputRequest = onUserInputOverride ?? defaultOnUserInputRequest;

    // c. Serialize message
    const deliveryMessage: Message = { ...message, contextId: task.contextId, taskId: task.id };
    const xmlPrompt = serializeMessageToXml(deliveryMessage);
    const prompt = injectCurrentDateTimeContext(xmlPrompt, getCurrentDateTimeContext());

    let session = await this.sessionFactory.createTaskSession(targetMindId, task.id, onUserInputRequest);
    this.sessions.set(task.id, session);

    // d. Bind listeners before send so we capture all events
    this.bindTaskSessionListeners(session, task, targetMindId);

    // e. Send prompt, with stale-session retry
    try {
      await session.send({ prompt });
    } catch (err) {
      if (!isStaleSessionError(err)) throw err;

      // Stale session — create a fresh one and retry once
      this.sessions.delete(task.id);
      session = await this.sessionFactory.createTaskSession(targetMindId, task.id, onUserInputRequest);
      this.sessions.set(task.id, session);
      this.bindTaskSessionListeners(session, task, targetMindId);
      await session.send({ prompt });
    }
  }

  private recordTaskLedgerSubmitted(task: A2ATask, targetMindId: string): void {
    try {
      this.getLedgerForMind(targetMindId)?.writer.createRunning({
        runtime: 'a2a',
        ownerMindId: targetMindId,
        scopeKind: 'system',
        task: `A2A task ${task.id}`,
        runKey: `a2a-${task.id}`,
        sourceId: task.id,
        a2aTaskId: task.id,
        contextId: task.contextId,
        payload: { runtime: 'a2a', a2aTaskId: task.id, contextId: task.contextId },
      });
    } catch (err) {
      log.warn(`Failed to create ledger row for A2A task ${task.id}:`, err);
    }
  }

  private finalizeTaskLedger(task: A2ATask): void {
    try {
      const targetMindId = this.taskTargets.get(task.id);
      if (!targetMindId) return;
      const ledger = this.getLedgerForMind(targetMindId);
      const ledgerRecord = ledger?.reader.getByRunKey('a2a', `a2a-${task.id}`);
      if (!ledgerRecord) return;
      ledger?.writer.finalize(ledgerRecord.ledgerId, {
        status: this.toLedgerStatus(task.status.state),
        terminalSummary: task.status.state,
        error: task.status.message?.parts?.find((part) => part.text)?.text,
      });
    } catch (err) {
      log.warn(`Failed to finalize ledger row for A2A task ${task.id}:`, err);
    }
  }

  private getLedgerForMind(mindId: string): TaskLedger | undefined {
    return this.options.getLedgerForMind?.(mindId) ?? this.options.ledger;
  }

  private getTTasksStore(mindId: string): Store | undefined {
    return this.options.createTTasksStore?.(mindId) ?? this.options.ttasksStore;
  }

  private toLedgerStatus(state: TaskState): 'succeeded' | 'failed' | 'timed-out' | 'cancelled' {
    switch (state) {
      case 'TASK_STATE_COMPLETED':
        return 'succeeded';
      case 'TASK_STATE_CANCELED':
        return 'cancelled';
      case 'TASK_STATE_FAILED':
      case 'TASK_STATE_REJECTED':
      case 'TASK_STATE_AUTH_REQUIRED':
      case 'TASK_STATE_INPUT_REQUIRED':
      case 'TASK_STATE_SUBMITTED':
      case 'TASK_STATE_WORKING':
        return 'failed';
      default: {
        const _exhaustive: never = state;
        throw new Error(`Unknown A2A task state: ${String(_exhaustive)}`);
      }
    }
  }

  private bindTaskSessionListeners(session: CopilotSession, task: A2ATask, targetMindId: string): void {
    void targetMindId;
    let responseText = '';

    session.on('assistant.message', (event) => {
      if (TERMINAL_STATES.has(task.status.state)) return;
      const content = event.data.content ?? '';
      if (content) {
        responseText += (responseText ? '\n' : '') + content;
        // Add to history
        task.history = task.history ?? [];
        task.history.push({
          messageId: generateMessageId(),
          role: 'ROLE_AGENT',
          parts: [{ text: content, mediaType: 'text/plain' }],
          contextId: task.contextId,
          taskId: task.id,
        });
      }
    });

    session.on('session.idle', () => {
      if (TERMINAL_STATES.has(task.status.state)) return;

      // Create artifact
      if (responseText) {
        const artifact = createArtifact('response', responseText);
        task.artifacts = task.artifacts ?? [];
        task.artifacts.push(artifact);

        const artifactEvent: TaskArtifactUpdateEvent & { targetMindId: string } = {
          taskId: task.id,
          contextId: task.contextId,
          artifact,
          lastChunk: true,
          targetMindId: this.taskTargets.get(task.id) ?? '',
        };
        this.emit('task:artifact-update', artifactEvent);
      }

      this.transitionState(task, 'TASK_STATE_COMPLETED');
      this.sessions.delete(task.id);
      this.taskTargets.delete(task.id);
    });

    session.on('session.error', (event) => {
      if (TERMINAL_STATES.has(task.status.state)) return;
      const errorMessage = getSessionErrorMessage(event);
      if (isStaleSessionError(new Error(errorMessage))) return;
      this.transitionState(task, 'TASK_STATE_FAILED');
      this.sessions.delete(task.id);
      this.taskTargets.delete(task.id);
    });
  }

  private transitionState(task: A2ATask, state: TaskState): void {
    task.status = createTaskStatus(state);
    this.emitStatusUpdate(task);
    this.persistTTasksResult(task, state);

    if (TERMINAL_STATES.has(state)) {
      this.finalizeTaskLedger(task);
      this.evictOldTasks();
      this.cleanupTaskResources(task.id);
    }
  }

  private persistTTasksTask(task: A2ATask, targetMindId: string, request: SendTaskRequest): void {
    try {
      const store = this.getTTasksStore(targetMindId);
      if (!store) return;

      const ttasksTask = TTasksTask.custom('chamber:a2a', JSON.stringify({
        recipient: request.recipient,
        message: request.message,
        contextId: task.contextId,
        referenceTaskIds: request.message.referenceTaskIds,
      }), {
        id: task.id,
        title: `A2A task ${task.id}`,
        description: request.message.parts.find((part) => part.text)?.text ?? 'A2A delegated task',
        createdAt: new Date(),
        metadata: {
          runtime: 'a2a',
          ownerMindId: targetMindId,
          scopeKind: 'system',
          sourceId: task.id,
          a2aTaskId: task.id,
          contextId: task.contextId,
        },
      });

      this.ttasksTasks.set(task.id, ttasksTask);
      store.tasks.save(ttasksTask);
    } catch (err) {
      log.warn(`Failed to persist ttasks row for A2A task ${task.id}:`, err);
    }
  }

  private persistTTasksResult(task: A2ATask, state: TaskState): void {
    try {
      const targetMindId = this.taskTargets.get(task.id) ?? undefined;
      const store = targetMindId ? this.getTTasksStore(targetMindId) : this.options.ttasksStore;
      const ttasksTask = this.ttasksTasks.get(task.id);
      if (!store || !ttasksTask) return;

      const status = toTTasksStatus(state);
      const output = summarizeArtifacts(task.artifacts) || summarizeStatusMessage(task.status.message);
      const errorMessage = task.status.message?.parts.find((part) => part.text)?.text ?? undefined;
      const error = errorMessage ?? null;

      if (status === TaskStatus.RUNNING) {
        ttasksTask.transitionTo(TaskStatus.RUNNING);
      } else {
        const result = new TaskResult({
          taskId: ttasksTask.id,
          status,
          startedAt: new Date(task.status.timestamp ?? Date.now()),
          finishedAt: new Date(task.status.timestamp ?? Date.now()),
          duration: 0,
          output,
          error,
          raw: output,
          returncode: status === TaskStatus.SUCCEEDED ? 0 : 1,
          terminationReason: null,
        });
        ttasksTask.transitionTo(status, { result, error: errorMessage });
      }

      store.tasks.save(ttasksTask);
    } catch (err) {
      log.warn(`Failed to update ttasks row for A2A task ${task.id}:`, err);
    }
  }

  private evictOldTasks(): void {
    const terminalTasks = [...this.tasks.entries()]
      .filter(([, t]) => TERMINAL_STATES.has(t.status.state))
      .sort((a, b) => {
        const tsA = a[1].status.timestamp ?? '';
        const tsB = b[1].status.timestamp ?? '';
        return tsA.localeCompare(tsB);
      });

    while (terminalTasks.length > TaskManager.MAX_COMPLETED_TASKS) {
      const entry = terminalTasks.shift();
      if (!entry) break;
      const [id] = entry;
      this.tasks.delete(id);
      this.ttasksTasks.delete(id);
    }
  }

  private cleanupTaskResources(taskId: string): void {
    this.pendingInputs.delete(taskId);
    this.taskTargets.delete(taskId);
    this.sessions.delete(taskId);
    this.ttasksTasks.delete(taskId);
  }

  private emitStatusUpdate(task: A2ATask): void {
    const event: TaskStatusUpdateEvent & { targetMindId: string } = {
      taskId: task.id,
      contextId: task.contextId,
      status: task.status,
      targetMindId: this.taskTargets.get(task.id) ?? '',
    };
    this.emit('task:status-update', event);
  }
}

function toTTasksStatus(state: TaskState): TaskStatus.SUCCEEDED | TaskStatus.FAILED | TaskStatus.CANCELLED | TaskStatus.RUNNING {
  switch (state) {
    case 'TASK_STATE_SUBMITTED':
    case 'TASK_STATE_WORKING':
    case 'TASK_STATE_INPUT_REQUIRED':
      return TaskStatus.RUNNING;
    case 'TASK_STATE_COMPLETED':
      return TaskStatus.SUCCEEDED;
    case 'TASK_STATE_FAILED':
    case 'TASK_STATE_REJECTED':
    case 'TASK_STATE_AUTH_REQUIRED':
      return TaskStatus.FAILED;
    case 'TASK_STATE_CANCELED':
      return TaskStatus.CANCELLED;
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unknown A2A task state: ${String(_exhaustive)}`);
    }
  }
}

function summarizeArtifacts(artifacts: A2ATask['artifacts']): string {
  return (artifacts ?? [])
    .map((artifact) => artifact.parts.map((part) => part.text ?? '').filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n');
}

function summarizeStatusMessage(message: A2ATask['status']['message']): string {
  return message?.parts.map((part) => part.text ?? '').filter(Boolean).join('\n') ?? '';
}

function getSessionErrorMessage(event: unknown): string {
  try {
    return getSdkSessionErrorMessage(event);
  } catch (error) {
    return getErrorMessage(error);
  }
}
