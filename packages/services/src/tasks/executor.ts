import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventBus, TaskEventType } from './events';
import { Task, TaskResult, TaskStatus, TaskType, type ProcessResult } from './task';

export class TaskCancelled extends Error {}

export class TaskExecutionError extends Error {
  constructor(message: string, readonly completed: ProcessResult) {
    super(message);
  }
}

export class TaskTimeoutError extends Error {
  constructor(message: string, readonly completed: ProcessResult) {
    super(message);
  }
}

export class TaskContext {
  readonly #task: Task;
  readonly #upstream: ReadonlyMap<string, Task>;

  constructor(task: Task, upstream?: ReadonlyMap<string, Task> | Record<string, Task>) {
    this.#task = task;
    const upstreamMap = upstream instanceof Map
      ? new Map(upstream)
      : new Map(Object.entries(upstream ?? {}));
    this.#upstream = readonlyMap(upstreamMap);
    Object.freeze(this);
  }

  get id(): string { return this.#task.id; }
  get title(): string { return this.#task.title; }
  get description(): string { return this.#task.description; }
  get payload(): string { return this.#task.payload; }
  get type(): TaskType { return this.#task.type; }
  get timeout(): number | null { return this.#task.timeout; }
  get status(): TaskStatus { return this.#task.status; }
  get cancelled(): boolean { return this.status === TaskStatus.Cancelled; }
  get upstream(): ReadonlyMap<string, Task> { return this.#upstream; }

  raiseIfCancelled(): void {
    if (this.cancelled) throw new TaskCancelled(`Task '${this.id}' was cancelled`);
  }
}

export type TaskHandler = (context: TaskContext) => unknown | Promise<unknown>;

function readonlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  return new Proxy(map, {
    get(target, prop, receiver) {
      if (prop === 'set' || prop === 'delete' || prop === 'clear') {
        return () => { throw new TypeError('upstream is read-only'); };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ReadonlyMap<K, V>;
}

export class TaskExecutor {
  #handlers = new Map<TaskType, TaskHandler>();
  #runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();
  readonly events = new EventBus();

  register(taskType: TaskType, handler: TaskHandler): void {
    if (!Object.values(TaskType).includes(taskType)) throw new TypeError('task_type must be a TaskType');
    if (typeof handler !== 'function') throw new TypeError('handler must be callable');
    this.#handlers.set(taskType, handler);
  }

  isRunning(taskId: string): boolean {
    const process = this.#runningProcesses.get(taskId);
    return Boolean(process && process.exitCode === null && !process.killed);
  }

  cancel(task: Task): void {
    task.cancel();
    const process = this.#runningProcesses.get(task.id);
    if (process && process.exitCode === null) this.terminateProcess(process);
  }

  async execute(task: Task, upstream?: ReadonlyMap<string, Task> | Record<string, Task>): Promise<TaskResult> {
    if (!task.canTransitionTo(TaskStatus.Running)) {
      throw new Error(`Cannot execute task with status '${task.status}'`);
    }
    const handler = this.#handlers.get(task.type);
    if (!handler) throw new Error(`No handler registered for task type '${task.type}'`);

    const previousStatus = task.status;
    task.transitionTo(TaskStatus.Running);
    this.emit(task, TaskEventType.Started, previousStatus);
    const startedAt = new Date();
    const started = performance.now();
    const timing = () => ({ finishedAt: new Date(), duration: (performance.now() - started) / 1000 });
    const context = new TaskContext(task, upstream);

    try {
      const raw = await handler(context);
      context.raiseIfCancelled();
      const result = TaskResult.fromRaw(task, raw, {
        status: TaskStatus.Done,
        startedAt,
        ...timing(),
      });
      task.result = result;
      task.transitionTo(TaskStatus.Done);
      this.emit(task, TaskEventType.Succeeded, TaskStatus.Running);
      return result;
    } catch (error) {
      if (error instanceof TaskCancelled) {
        if (task.status !== TaskStatus.Cancelled) task.cancel();
        const result = new TaskResult({
          taskId: task.id,
          status: TaskStatus.Cancelled,
          startedAt,
          ...timing(),
          error: error.message,
        });
        task.result = result;
        this.emit(task, TaskEventType.Cancelled, TaskStatus.Running, error.message);
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (task.status === TaskStatus.Cancelled) {
        const cancelled = new TaskCancelled(`Task '${task.id}' was cancelled`);
        task.result = new TaskResult({
          taskId: task.id,
          status: TaskStatus.Cancelled,
          startedAt,
          ...timing(),
          error: message,
        });
        this.emit(task, TaskEventType.Cancelled, TaskStatus.Running, message);
        throw cancelled;
      }

      task.transitionTo(TaskStatus.Failed, message);
      if (error instanceof TaskExecutionError || error instanceof TaskTimeoutError) {
        const completed = error.completed;
        const resultError = error instanceof TaskExecutionError ? completed.stderr || message : message;
        task.result = new TaskResult({
          taskId: task.id,
          status: TaskStatus.Failed,
          startedAt,
          ...timing(),
          output: completed.stdout ?? '',
          error: resultError,
          returncode: completed.code,
          raw: completed,
        });
      } else {
        task.result = new TaskResult({
          taskId: task.id,
          status: TaskStatus.Failed,
          startedAt,
          ...timing(),
          error: message,
        });
      }
      this.emit(task, TaskEventType.Failed, TaskStatus.Running, message);
      throw error;
    }
  }

  async runCommand(context: TaskContext, args: string | readonly string[], options: { shell?: boolean } = {}): Promise<ProcessResult> {
    const command = Array.isArray(args) ? args[0] : args;
    const commandArgs = Array.isArray(args) ? [...args.slice(1)] : [];
    const process = spawn(command, commandArgs, {
      shell: options.shell ?? false,
      detached: globalThis.process.platform !== 'win32',
      windowsHide: true,
    });
    this.#runningProcesses.set(context.id, process);
    if (context.cancelled) this.terminateProcess(process);

    let stdout = '';
    let stderr = '';
    process.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const completed = await new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.#runningProcesses.delete(context.id);
        fn();
      };
      const timer = context.timeout === null ? null : setTimeout(() => {
        timedOut = true;
        this.terminateProcess(process);
      }, context.timeout * 1000);
      timer?.unref?.();

      process.once('error', (error) => {
        finish(() => reject(error));
      });
      process.once('close', (code, signal) => {
        const result = { args, code: code ?? -1, signal, stdout, stderr };
        if (timedOut) {
          finish(() => reject(new TaskTimeoutError(`Task timed out after ${context.timeout} seconds`, result)));
        } else {
          finish(() => resolve(result));
        }
      });
    });

    if (completed.code !== 0) {
      if (context.cancelled) throw new TaskCancelled(`Task '${context.id}' was cancelled`);
      throw new TaskExecutionError(completed.stderr || `exited with code ${completed.code}`, completed);
    }
    return completed;
  }

  terminateProcess(process: ChildProcessWithoutNullStreams): void {
    if (process.exitCode !== null) return;
    try {
      if (process.pid && globalThis.process.platform !== 'win32') {
        globalThis.process.kill(-process.pid, 'SIGTERM');
      } else {
        process.kill('SIGTERM');
      }
    } catch {
      return;
    }
    setTimeout(() => {
      if (process.exitCode === null) {
        try {
          if (process.pid && globalThis.process.platform !== 'win32') globalThis.process.kill(-process.pid, 'SIGKILL');
          else process.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 100).unref?.();
  }

  private async runBash(context: TaskContext): Promise<ProcessResult> {
    return this.runCommand(context, context.payload, { shell: true });
  }

  private async runPowerShell(context: TaskContext): Promise<ProcessResult> {
    return this.runCommand(context, ['pwsh', '-Command', context.payload]);
  }

  private emit(task: Task, type: TaskEventType, previousStatus: TaskStatus | null, error?: string): void {
    this.events.emit({
      type,
      taskId: task.id,
      task,
      timestamp: new Date(),
      previousStatus,
      status: task.status,
      error,
    });
  }

  static createDefault(): TaskExecutor {
    const executor = new TaskExecutor();
    executor.register(TaskType.Bash, (context) => executor.runBash(context));
    executor.register(TaskType.PowerShell, (context) => executor.runPowerShell(context));
    executor.register(TaskType.Prompt, makeCopilotPromptHandler());
    executor.register(TaskType.Agent, makeCopilotAgentHandler());
    return executor;
  }
}

export const DEFAULT_COPILOT_PROMPT_MODEL = 'gpt-5.4-mini';
export const DEFAULT_COPILOT_PROMPT_TIMEOUT = 60;
export const DEFAULT_COPILOT_AGENT_MODEL = 'gpt-5.5';

export interface FakeCopilotSessionResponse { data?: { content?: string } | null }
export type CopilotSessionFactory = (options: Record<string, unknown>) => {
  sendAndWait(prompt: string, options: { timeout: number | null }): Promise<FakeCopilotSessionResponse | null>;
} | Promise<{
  sendAndWait(prompt: string, options: { timeout: number | null }): Promise<FakeCopilotSessionResponse | null>;
}>;

let copilotSessionFactory: CopilotSessionFactory | null = null;
export function setCopilotSessionFactory(factory: CopilotSessionFactory | null): void {
  copilotSessionFactory = factory;
}

export function makeCopilotPromptHandler(options: { model?: string; timeout?: number } = {}): TaskHandler {
  const model = options.model ?? DEFAULT_COPILOT_PROMPT_MODEL;
  const timeout = options.timeout ?? DEFAULT_COPILOT_PROMPT_TIMEOUT;
  if (!model) throw new Error('model must not be empty');
  if (timeout <= 0) throw new Error('timeout must be greater than 0');
  return (context) => runCopilotText(context, { model, defaultTimeout: timeout, toolsEnabled: false });
}

export function makeCopilotAgentHandler(options: { model?: string } = {}): TaskHandler {
  const model = options.model ?? DEFAULT_COPILOT_AGENT_MODEL;
  if (!model) throw new Error('model must not be empty');
  return (context) => runCopilotText(context, { model, defaultTimeout: null, toolsEnabled: true });
}

async function runCopilotText(context: TaskContext, options: { model: string; defaultTimeout: number | null; toolsEnabled: boolean }): Promise<string> {
  context.raiseIfCancelled();
  if (!copilotSessionFactory) throw new Error('Copilot session factory is not configured');
  const session = await copilotSessionFactory({
    model: options.model,
    availableTools: options.toolsEnabled ? undefined : [],
    toolsEnabled: options.toolsEnabled,
  });
  const response = await session.sendAndWait(context.payload, { timeout: context.timeout ?? options.defaultTimeout });
  context.raiseIfCancelled();
  return response?.data?.content ?? '';
}

export function makeDefaultExecutor(): TaskExecutor {
  return TaskExecutor.createDefault();
}

export { TaskResult } from './task';
