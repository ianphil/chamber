# Research: Task orchestration in Chamber, informed by ttasks

This side quest was prompted by the [`ttasks`](https://github.com/ipdelete/ttasks) repository, which explores a small Python task ledger, executor, event stream, and DAG workflow library. While `ttasks` is Python and Chamber is TypeScript, it helped clarify the separation Chamber may want between:

- live task execution/orchestration
- durable run/audit persistence
- UI-facing task projections

After looking through Chamber, the instinct seems right: Chamber has several “task-ish” systems that are converging, but the current ledger is more of an **audit/history table** than a true task execution model.

The relevant pieces observed:

- `packages/services/src/ledger/*`
  - persistent `TaskLedger`
  - `LedgerWriter`, `LedgerReader`, `LedgerCanceller`
  - SQLite/in-memory stores
  - `safelyRecordRun(...)`
- `packages/shared/src/ledger.ts`
  - `LedgerRecord`
  - runtimes: `'a2a' | 'cron' | 'acp-child' | 'chatroom' | 'local'`
- `packages/services/src/cron/CronService.ts`
  - owns scheduling, in-flight tracking, run execution, and writes audit rows
- `packages/services/src/cron/JobRunner.ts`
  - executes prompt/shell/webhook/notification jobs
- `packages/services/src/a2a/TaskManager.ts`
  - has its own in-memory A2A task lifecycle
  - writes/finalizes audit ledger rows as a side effect
- `packages/services/src/chatroom/ChatroomService.ts`
  - persists a separate chatroom task ledger
- `packages/services/src/session-group/orchestrators/MagenticStrategy.ts`
  - maintains `TaskLedgerItem[]` as an in-memory planning/execution ledger
- `apps/desktop/src/main/ipc/tasks.ts`
  - exposes the persistent ledger over IPC
  - cancellation is mostly not wired yet

## My read

Chamber currently has at least three different concepts called or shaped like “tasks”:

### 1. Persistent run/audit ledger

This is `packages/services/src/ledger/TaskLedger`.

It records things like:

```ts
runtime: 'cron' | 'a2a' | 'chatroom' | ...
status: 'running' | 'succeeded' | 'failed' | ...
ownerMindId
payload
cleanupAfter
terminalSummary
progressSummary
```

This is valuable, but it is mostly a **journal/projection** of work that happened.

It does not own:

- state transitions as a domain object
- handler execution
- dependency graphs
- lifecycle events
- cancellation behavior beyond returning “not wired yet”
- upstream/downstream relationships

So I’d mentally rename it:

```ts
TaskLedger -> TaskRunLedger
```

or

```ts
TaskLedger -> RunLedger
```

Even if we don’t actually rename it immediately, that distinction matters.

### 2. Live execution tasks

A2A has this:

```ts
TaskManager.tasks = new Map<string, Task>()
```

Cron has this:

```ts
private readonly inFlightJobs = new Set<string>();
```

Chatroom/Magentic has this:

```ts
const ledger: TaskLedgerItem[] = [];
```

These are closer to what `ttasks` models: live work units with state transitions, outputs, cancellation, and possibly dependencies.

### 3. UI/display task ledgers

Chatroom’s `TaskLedgerItem` is a simplified UI-facing plan:

```ts
{
  id,
  description,
  assignee,
  status: 'pending' | 'in-progress' | 'completed' | 'failed',
  result
}
```

That’s useful, but it is a view/projection, not the core execution model.

## The thing I’d avoid

I would avoid making the existing Chamber `TaskLedger` become the orchestrator/executor directly.

It already has a clear job:

> store task/run records for IPC, audit, cleanup, and user visibility.

If we push orchestration into it, it becomes muddy:

- persistence concern
- execution concern
- cancellation concern
- UI concern
- A2A concern
- cron concern
- chatroom concern

That’s probably why it feels uncomfortable there.

## The thing I’d add

I’d add a new Chamber service/package layer inspired by `ttasks`, probably something like:

```text
packages/services/src/tasks/
  Task.ts
  TaskResult.ts
  TaskExecutor.ts
  TaskGraph.ts
  TaskEvents.ts
  TaskRunProjector.ts
```

Or perhaps:

```text
packages/services/src/workflows/
```

The key distinction:

```text
TaskExecutor / TaskGraph = live orchestration
TaskLedger / LedgerStore = durable audit projection
```

## Possible TypeScript shape

Something like:

```ts
export type ChamberTaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface ChamberTask<TPayload = unknown, TResult = unknown> {
  id: string;
  title: string;
  description?: string;
  runtime: TaskRuntime;
  type: string;
  payload: TPayload;
  status: ChamberTaskStatus;
  result?: TaskResult<TResult>;
  error?: string;
  createdAt: string;
  timeoutMs?: number;
  ownerMindId?: string;
  sourceId?: string;
  runKey?: string;
}
```

Handler contract:

```ts
export interface TaskContext<TPayload = unknown> {
  task: ChamberTask<TPayload>;
  signal: AbortSignal;
  upstream: ReadonlyMap<string, ChamberTask>;
  emitProgress(summary: string): void;
}

export type TaskHandler<TPayload = unknown, TResult = unknown> =
  (context: TaskContext<TPayload>) => Promise<TResult>;
```

Executor:

```ts
executor.register('cron:shell', shellHandler);
executor.register('cron:webhook', webhookHandler);
executor.register('a2a:send-task', a2aTaskHandler);
executor.register('chatroom:worker-turn', chatroomWorkerHandler);

await executor.execute(task);
```

Graph:

```ts
const graph = new TaskGraph();

graph.add(taskA);
graph.add(taskB, { after: [taskA] });

graph.addFinally(reportTask, {
  after: [taskA, taskB],
  required: false,
});

await graph.run(executor);
```

Events:

```ts
executor.events.on('task:started', ...)
executor.events.on('task:succeeded', ...)
executor.events.on('task:failed', ...)
executor.events.on('task:cancelled', ...)
executor.events.on('task:progress', ...)
```

Projection into existing durable ledger:

```ts
executor.events.on('task:started', event =>
  runLedger.writer.createRunning(...)
);

executor.events.on('task:succeeded', event =>
  runLedger.writer.finalize(..., { status: 'succeeded' })
);
```

That keeps the current SQLite ledger useful without making it own orchestration.

## How this maps to Chamber

### Cron

Cron is probably the best first integration.

Right now `CronService.runJob(...)` does a lot:

- duplicate in-flight detection
- ledger row creation
- job execution
- result mapping
- job run history mapping
- job last-run state updates

A task executor could own the execution lifecycle. Cron would become mostly:

```ts
const task = taskFactory.fromCronJob(job);

await executor.execute(task);
```

Or for scheduled jobs:

```ts
scheduler.schedule(job, () => taskRunner.submitCronJob(mindId, job));
```

Handlers:

- `cron:prompt`
- `cron:shell`
- `cron:webhook`
- `cron:notification`

This would simplify `safelyRecordRun(...)` too. Instead of every producer remembering how to safely write the ledger, the executor event stream can project all runs consistently.

### A2A tasks

A2A already has a TaskManager with a domain lifecycle:

```ts
SUBMITTED -> WORKING -> COMPLETED / FAILED / CANCELED / INPUT_REQUIRED
```

This one is trickier because A2A has protocol-specific states and streaming artifacts.

I would not immediately replace `TaskManager`.

Instead I’d adapt it:

```ts
a2a_send_task -> creates ChamberTask
ChamberTask handler -> calls TaskManager.sendTask(...)
handler waits for A2A terminal state
handler returns artifacts/result
```

Then `TaskManager` can continue to serve A2A protocol semantics, while the common task system tracks the execution/audit view.

Eventually, maybe A2A `TaskManager` itself becomes a specialized handler/executor.

### Chatroom / Magentic

This is where it gets really interesting.

`MagenticStrategy` is already doing a dynamic task graph manually:

- manager plans tasks
- tasks are pending/in-progress/completed/failed
- manager assigns workers
- workers run in parallel
- manager synthesizes at the end

That is basically a workflow engine.

Today it uses:

```ts
TaskLedgerItem[]
```

But it could use a real `TaskGraph` or at least a `TaskLedger`-style live task registry and project to `TaskLedgerItem[]` for UI.

Example:

```ts
const graph = new TaskGraph();

for (const planned of plan) {
  graph.add(workerTask(planned));
}

graph.addFinally(synthesisTask, {
  after: graph.tasks,
  required: false,
});
```

For Magentic, you may need dynamic graph mutation:

- manager creates initial tasks
- manager adds tasks later
- manager assigns/reassigns tasks
- some tasks may depend on prior completed work
- synthesis is a `finally` task

That maps very naturally to what we discovered in `ttasks`.

## Big design point: cancellation

Chamber needs a stronger version of cancellation than current `LedgerCanceller`.

Right now:

```ts
Cancellation for a2a is not wired yet.
Cancellation for chatroom is not wired yet.
```

A proper task executor should own active controllers:

```ts
private active = new Map<string, AbortController>();
```

Then:

```ts
executor.cancel(taskId)
```

does:

1. mark task cancellation requested
2. abort handler signal
3. let handler clean up
4. force terminal `cancelled` if needed
5. emit event
6. project to durable ledger

Cron shell jobs can kill child processes.

A2A can call `TaskManager.cancelTask`.

Chatroom can abort session group / worker turn.

This is a major reason to have an executor separate from the audit ledger.

## Proposed architecture

I’d draw it like this:

```text
            cron / a2a / chatroom
                    |
                    v
          ChamberTask / TaskGraph
                    |
                    v
              TaskExecutor
                    |
          lifecycle event stream
          /          |          \
         v           v           v
  SQLite RunLedger   Renderer UI  logs/notifications
```

The durable ledger becomes one subscriber/projection of task events.

Not the center of gravity.

## Incremental plan I’d use

### Step 1: Name the separation

Create an ADR or issue in Chamber:

> Separate live task orchestration from persistent run ledger.

Define:

- `Task` = live execution unit
- `TaskResult` = terminal result
- `TaskExecutor` = handler dispatch/cancellation/events
- `TaskGraph` = dependencies/finalizers
- `RunLedger` / existing `TaskLedger` = persistence projection

### Step 2: Build a small TS `ttasks`-like core

Do not migrate all of Chamber yet.

Implement in isolation with tests:

- task state machine
- executor
- typed event emitter
- cancellation via `AbortController`
- timeout support
- result normalization
- graph dependencies
- finally tasks
- optional tasks

This can live under:

```text
packages/services/src/tasks/
```

### Step 3: Add a ledger projection adapter

Something like:

```ts
class LedgerTaskEventProjector {
  onTaskStarted(event) { writer.createRunning(...) }
  onTaskSucceeded(event) { writer.finalize(..., { status: 'succeeded' }) }
  onTaskFailed(event) { writer.finalize(..., { status: 'failed' }) }
  onTaskCancelled(event) { writer.finalize(..., { status: 'cancelled' }) }
}
```

This lets existing IPC and UI continue using `LedgerRecord`.

### Step 4: Migrate Cron first

Cron has bounded, concrete handlers:

- prompt
- shell
- webhook
- notification

It is the easiest place to prove the model.

### Step 5: Adapt A2A

Wrap A2A task submission/waiting as task handlers, rather than rewriting A2A from scratch.

### Step 6: Refactor Chatroom/Magentic

Use the task system as the underlying execution/ledger engine, while preserving the current `TaskLedgerPanel` projection.

## One naming caution

Because Chamber already has `TaskLedger`, I’d avoid reusing that name for the new live in-memory task registry.

Options:

- Keep existing `TaskLedger`, call new thing `TaskRuntime`
- Rename existing eventually to `RunLedger`
- New types:
  - `LiveTask`
  - `TaskRun`
  - `TaskOrchestrator`
  - `WorkflowTask`
  - `TaskGraph`

Personally:

```text
TaskGraph
TaskExecutor
TaskRunLedger
```

feels clean.

## The punchline

I think `ttasks` is almost exactly the missing conceptual layer for Chamber, but the Chamber version should be:

- async-first
- AbortController-based
- event-driven
- projected into SQLite
- runtime-aware
- UI-friendly
- able to handle dynamic graphs for chatroom

The current Chamber ledger should probably stay as persistence/audit, not become the executor.

Cron is the ideal first migration. Chatroom is the most exciting eventual payoff. A2A sits in the middle as an adapter around protocol-specific task state.
