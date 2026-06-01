# ttasks-ts API Reference

## Install

```bash
pnpm add github:ianphil/ttasks-ts#v0.3.0
```

## Imports

```typescript
import {
  Task, TaskResult, TaskStatus, TaskType,
  TaskExecutor, TaskContext, RetryPolicy,
  TaskGraph,
  SqliteStore, InMemoryStore,
  TaskCancelled, TaskExecutionError, TaskTimeoutError,
  SubprocessFailureError, MissingHandlerError,
  EventBus, TaskEventType,
  CopilotAgentSession,
  makeCopilotPromptHandler, makeCopilotAgentHandler,
} from '@ianphil/ttasks-ts';

import { createBashHandler }       from '@ianphil/ttasks-ts';
import { createPowershellHandler } from '@ianphil/ttasks-ts';
```

---

## Task

### Factories
```typescript
Task.bash(payload, init?)         // shell script — runs via `bash -c`
Task.powershell(payload, init?)   // runs via `pwsh -Command`
Task.prompt(payload, init?)       // single-turn LLM: summarize, classify, extract (no tools)
Task.agent(payload, init?)        // multi-turn agent with tools: browse, edit files, commit
Task.custom(type, payload, init?) // any string type you register a handler for
new Task(type, payload, init?)    // explicit constructor
```

**`Task.prompt()` vs `Task.agent()`**: Use `prompt` for one-shot text generation (no tool calls, cheaper, faster). Use `agent` when the LLM needs to use tools (read files, run commands, browse web, make commits). Both require a registered handler and a `CopilotProvider` — see [patterns/agent-tasks.md](../patterns/agent-tasks.md).

### `TaskInit` options
```typescript
{
  title?: string;       // display name (default: '')
  description?: string; // free-text notes
  timeout?: number;     // seconds; undefined = no timeout
  id?: string;          // provide to restore a known identity
  metadata?: Record<string, JsonValue>; // frozen JSON bag, survives SQLite
}
```

### Properties (read-only after SUCCEEDED)
```typescript
task.id          // immutable UUID
task.type        // TaskType string
task.payload     // string passed to the handler
task.title       // string
task.status      // TaskStatus enum
task.result      // TaskResult | null (null until task runs or if BLOCKED)
task.blockedBy   // string | undefined (id of the dep that caused BLOCKED)
task.error       // string | undefined
task.metadata    // TaskMetadata (frozen plain object)
```

### Status predicates
```typescript
task.isPending   task.isRunning   task.isSucceeded
task.isFailed    task.isCancelled task.isBlocked
task.isSink      // true for SUCCEEDED | CANCELLED (no outbound transitions)
task.isActive    // true for PENDING | RUNNING
task.isBad       // true for FAILED | CANCELLED | BLOCKED
```

### State machine
```typescript
task.canTransitionTo(status)       // boolean
task.transitionTo(status, opts?)   // throws InvalidTransitionError if illegal
task.cancel(opts?)                 // idempotent; no-op if SUCCEEDED/CANCELLED
```

---

## TaskResult

```typescript
result.taskId           // string
result.status           // TaskStatus
result.output           // string (stdout for bash; handler return for custom)
result.error            // string | null (stderr for bash; exception message)
result.returncode       // number | null (null for non-subprocess handlers)
result.terminationReason // null | 'exit_code' | 'timeout' | 'cancelled' | 'handler'
result.startedAt        // Date
result.finishedAt       // Date
result.duration         // milliseconds
```

---

## TaskExecutor

```typescript
const exec = new TaskExecutor();           // no handlers pre-registered
const exec = new TaskExecutor({ store });  // with SQLite persistence
const exec = TaskExecutor.empty();         // alias for new TaskExecutor()
```

### Handler registration
```typescript
exec.register(TaskType.BASH, createBashHandler());
exec.register('my-type', async (ctx: TaskContext) => {
  return ctx.payload.toUpperCase(); // string return → result.output
});
exec.isRegistered('my-type'); // boolean
```

### Execution
```typescript
const result = await exec.execute(task);
const result = await exec.execute(task, {
  upstream: new Map([[depTask.id, depTask]]), // pass dep task refs
  retryPolicy: new RetryPolicy({ maxAttempts: 3, backoff: 1.0 }),
  signal: abortController.signal,
});
```

### Submit (fire-and-forget with cancel handle)
```typescript
const handle = exec.submit(task);
handle.cancel(); // only cancels if not yet RUNNING
const result = await handle;
```

### Cancellation
```typescript
exec.cancel(task); // idempotent; SIGTERM → SIGKILL for subprocesses
```

### Shutdown
```typescript
await exec.shutdown(); // drain all in-flight tasks, then block new submit()
await exec.close();    // alias
await using exec = new TaskExecutor(); // Symbol.asyncDispose
```

### Persistence errors (non-fatal)
```typescript
exec.persistenceErrors      // readonly PersistenceError[]
exec.graphPersistenceErrors // readonly GraphPersistenceError[]
```

### Events
```typescript
exec.events.subscribe((event: TaskEvent) => {
  // event.type: TaskEventType
  // event.task: Task
  // event.timestamp: Date
  // event.previousStatus: TaskStatus | undefined
  // event.error: string | undefined
  // event.percent / event.message  (for PROGRESS events)
  // event.stream / event.chunk     (for OUTPUT events)
});
```

---

## TaskContext (inside handlers)

```typescript
async function handler(ctx: TaskContext): Promise<unknown> {
  ctx.id          // task id
  ctx.payload     // task payload string
  ctx.title       // task title
  ctx.timeout     // number | undefined
  ctx.upstream    // ReadonlyMap<string, Task> — direct dep tasks
  ctx.signal      // AbortSignal — honour for cooperative cancellation
  ctx.cancelled   // boolean shortcut

  ctx.raiseIfCancelled();   // throws TaskCancelled if cancelled
  ctx.emitProgress(50, 'halfway'); // emit PROGRESS event
  ctx.emitOutput('stdout', chunk); // emit OUTPUT event chunk
}
```

---

## RetryPolicy

```typescript
new RetryPolicy({ maxAttempts: 3 })
new RetryPolicy({ maxAttempts: 3, backoff: 2.0 }) // 2s between attempts
```

Cancellation is never retried. Backoff sleep is cancel-aware (checks every 25ms).

---

## TaskGraph

```typescript
const g = new TaskGraph({ title: 'my-workflow' });
```

### Adding tasks
```typescript
g.add(task)                                          // root task, no deps
g.add(task, { after: [dep1, dep2] })                 // depends on dep1 and dep2
g.add(cleanup, { after: [step], finally_: true })    // required finally
g.add(cleanup, { after: [step], finally_: true, required: false }) // optional finally
```

`finally_` tasks run when all listed deps are **inactive** (succeeded/failed/cancelled/blocked) rather than only when they succeeded. `required: false` means its failure doesn't affect `g.ok`.

### Running
```typescript
await g.run(exec);                        // maxWorkers: 4 default
await g.run(exec, { maxWorkers: 1 });     // serialize (required for agent tasks)
```

### Outcome
```typescript
g.ok              // true iff all required tasks SUCCEEDED (the right check)
g.succeeded       // Task[]
g.failed          // Task[]
g.blocked         // Task[]
g.cancelled       // Task[]
g.requiredFailed  // failed tasks that count against ok
g.requiredBlocked // blocked tasks that count against ok
g.optionalFailed  // finally optional tasks that failed (don't affect ok)
g.errors          // ReadonlyMap<string, Error> — executor errors per task
```

### Topology
```typescript
g.tasks           // Task[] in insertion order
g.dependencies(t) // Task[] — direct upstream deps
g.roots()         // Task[] — tasks with no deps
g.leaves()        // Task[] — tasks nothing depends on
g.isFinally(t)    // boolean
g.isOptional(t)   // boolean
g.length          // number of tasks
```

### Restore from store
```typescript
const g2 = store.graphs.get(graphId)!; // returns a restored TaskGraph
```

---

## SqliteStore

```typescript
import { SqliteStore } from '@ianphil/ttasks-ts';

const store = new SqliteStore({ path: './tasks.db' });
const store = new SqliteStore({ path: ':memory:' }); // in-process, no file

// Pass to executor for auto-persistence
const exec = new TaskExecutor({ store });

// Manual access
store.tasks.save(task);
store.tasks.get(taskId);     // Task | undefined
store.tasks.has(taskId);     // boolean
store.tasks.delete(taskId);
store.tasks.size;

store.graphs.save(graph);    // atomic: graph + tasks + edges in one transaction
store.graphs.get(graphId);   // TaskGraph | undefined
store.graphs.has(graphId);
for (const id of store.graphs.ids()) { ... }

store.close(); // always close when done
```

Schema mismatch on open throws `StoreSchemaMismatchError`. Pass `allowDestructiveMigration: true` to drop and rebuild (loses all data).

---

## Built-in Handlers

```typescript
import { createBashHandler }       from '@ianphil/ttasks-ts';
import { createPowershellHandler } from '@ianphil/ttasks-ts';

exec.register(TaskType.BASH,       createBashHandler());
exec.register(TaskType.BASH,       createBashHandler({ bashPath: '/usr/local/bin/bash' }));
exec.register(TaskType.POWERSHELL, createPowershellHandler());
```

`createBashHandler` runs `bash -c <payload>`. Non-zero exit → `SubprocessFailureError` (carries stdout/stderr/returncode). Timeout → `TaskTimeoutError`.

---

## Errors

```typescript
TaskCancelled          // task was cancelled (never retried)
TaskExecutionError     // general handler failure
TaskTimeoutError       // extends TaskExecutionError; timeout exceeded
SubprocessFailureError // extends TaskExecutionError; has .completion + .terminationReason
MissingHandlerError    // no handler registered for task.type
InvalidTransitionError // illegal state-machine transition
TaskMutationError      // tried to mutate a SUCCEEDED task
ExecutorShutdownError  // submit() after shutdown()
StoreSchemaMismatchError
StoreKeyError
```
