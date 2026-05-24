import { randomUUID } from 'node:crypto';

export enum TaskStatus {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export enum TaskType {
  Bash = 'bash',
  PowerShell = 'powershell',
  Prompt = 'prompt',
  Agent = 'agent',
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  [TaskStatus.Pending]: new Set([TaskStatus.Running, TaskStatus.Cancelled]),
  [TaskStatus.Running]: new Set([TaskStatus.Done, TaskStatus.Failed, TaskStatus.Cancelled]),
  [TaskStatus.Failed]: new Set([TaskStatus.Running, TaskStatus.Cancelled]),
  [TaskStatus.Done]: new Set(),
  [TaskStatus.Cancelled]: new Set(),
};

function isTaskStatus(value: unknown): value is TaskStatus {
  return Object.values(TaskStatus).includes(value as TaskStatus);
}

function isTaskType(value: unknown): value is TaskType {
  return Object.values(TaskType).includes(value as TaskType);
}

export interface TaskResultInput {
  taskId: string;
  status: TaskStatus;
  startedAt: Date;
  finishedAt: Date;
  duration: number;
  output?: string;
  error?: string;
  returncode?: number;
  raw?: unknown;
}

export class TaskResult {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly duration: number;
  readonly output: string;
  readonly error?: string;
  readonly returncode?: number;
  readonly raw?: unknown;

  constructor(input: TaskResultInput) {
    this.taskId = input.taskId;
    this.status = input.status;
    this.startedAt = input.startedAt;
    this.finishedAt = input.finishedAt;
    this.duration = input.duration;
    this.output = input.output ?? '';
    this.error = input.error;
    this.returncode = input.returncode;
    this.raw = input.raw;
    Object.freeze(this);
  }

  static fromRaw(task: Task, raw: unknown, input: Omit<TaskResultInput, 'taskId' | 'raw' | 'output' | 'error' | 'returncode'>): TaskResult {
    if (isProcessResult(raw)) {
      return new TaskResult({
        ...input,
        taskId: task.id,
        output: raw.stdout ?? '',
        error: raw.stderr || undefined,
        returncode: raw.code,
        raw,
      });
    }
    if (typeof raw === 'string') {
      return new TaskResult({ ...input, taskId: task.id, output: raw, raw });
    }
    return new TaskResult({ ...input, taskId: task.id, raw });
  }
}

export interface ProcessResult {
  args: string | readonly string[];
  code: number;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export function isProcessResult(value: unknown): value is ProcessResult {
  return Boolean(
    value
      && typeof value === 'object'
      && 'code' in value
      && 'stdout' in value
      && 'stderr' in value,
  );
}

export interface TaskInput {
  title: string;
  payload: string;
  type: TaskType;
  description?: string;
  error?: string | null;
  timeout?: number | null;
}

export class Task {
  readonly createdAt = new Date();
  #id = randomUUID();
  #status = TaskStatus.Pending;
  #title: string;
  #description: string;
  #payload: string;
  #type: TaskType;
  #error: string | null;
  #timeout: number | null;
  #result: TaskResult | null = null;

  constructor(input: TaskInput) {
    if (!isTaskType(input.type)) throw new TypeError('type must be a TaskType');
    if (input.timeout !== undefined && input.timeout !== null && input.timeout <= 0) {
      throw new Error('timeout must be greater than 0');
    }
    this.#title = input.title;
    this.#payload = input.payload;
    this.#type = input.type;
    this.#description = input.description ?? '';
    this.#error = input.error ?? null;
    this.#timeout = input.timeout ?? null;
  }

  get id(): string { return this.#id; }
  set id(_value: string) { throw new TypeError('id is read-only'); }

  get status(): TaskStatus { return this.#status; }
  set status(_value: TaskStatus) { throw new TypeError('status is read-only'); }

  get title(): string { return this.#title; }
  set title(value: string) { this.assertMutable(); this.#title = value; }

  get description(): string { return this.#description; }
  set description(value: string) { this.assertMutable(); this.#description = value; }

  get payload(): string { return this.#payload; }
  set payload(value: string) { this.assertMutable(); this.#payload = value; }

  get type(): TaskType { return this.#type; }
  set type(value: TaskType) { this.assertMutable(); if (!isTaskType(value)) throw new TypeError('type must be a TaskType'); this.#type = value; }

  get error(): string | null { return this.#error; }
  set error(value: string | null) { this.assertMutable(); this.#error = value; }

  get timeout(): number | null { return this.#timeout; }
  set timeout(value: number | null) {
    this.assertMutable();
    if (value !== null && value <= 0) throw new Error('timeout must be greater than 0');
    this.#timeout = value;
  }

  get result(): TaskResult | null { return this.#result; }
  set result(value: TaskResult | null) { this.assertMutable(); this.#result = value; }

  canTransitionTo(status: TaskStatus): boolean {
    if (!isTaskStatus(status)) throw new TypeError('status must be a TaskStatus');
    return ALLOWED_TRANSITIONS[this.#status].has(status);
  }

  transitionTo(status: TaskStatus, error: string | null = null): void {
    if (!isTaskStatus(status)) throw new TypeError('status must be a TaskStatus');
    if (!this.canTransitionTo(status)) {
      throw new Error(`Cannot transition task from '${this.#status}' to '${status}'`);
    }
    this.#error = error;
    this.#status = status;
  }

  cancel(): void {
    if (this.status === TaskStatus.Cancelled) return;
    this.transitionTo(TaskStatus.Cancelled, this.error);
  }

  toString(): string {
    return `Task(id='${this.id}', title='${this.title}', status=${this.status})`;
  }

  private assertMutable(): void {
    if (this.#status === TaskStatus.Done) {
      throw new TypeError('DONE tasks are immutable');
    }
  }
}
