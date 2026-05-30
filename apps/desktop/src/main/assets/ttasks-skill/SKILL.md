---
name: ttasks
description: "TypeScript task runner and workflow engine using @ianphil/ttasks-ts. Use this skill whenever you need to run, chain, or orchestrate TypeScript operations — even if the user hasn't mentioned ttasks. Reach for it when they want to: run a shell command and track the result, chain steps where later ones depend on earlier ones ('do X then Y then Z'), run tasks in parallel and merge results, ensure cleanup always runs even after a failure, persist step results to disk so they survive a crash, include an LLM prompt or agent step inside a workflow, or find out exactly which step in a pipeline broke. Also triggers on: build pipeline, automate steps, retry on failure, parallel tasks, workflow with dependencies, 'if one step fails skip the rest', task queue in TypeScript. DO NOT USE FOR: non-TypeScript projects, throwaway one-liners that don't need tracking."
---

# ttasks-ts

TypeScript library for running one-off tasks or multi-step dependency graphs with parallel execution, failure isolation, retry, and optional SQLite persistence.

Package: `@ianphil/ttasks-ts` — install with:
```bash
pnpm add github:ianphil/ttasks-ts#v0.3.0
```

---

## Decision Tree

```
Single operation?                         →  executor.execute(task)
Multiple steps with dependencies?         →  TaskGraph + graph.run(executor)
Cleanup must run even if a step fails?    →  finally_ task in graph
Results must survive a process crash?     →  SqliteStore
One-shot LLM summarize/classify/etc?     →  Task.prompt()  (no tools, one turn)
LLM agent that browses/edits/commits?     →  Task.agent() + CopilotAgentSession  ¹
Domain-specific typed operation?          →  Task.custom('my-type') + exec.register()
```

¹ Agent tasks require a `CopilotProvider` implementation — the library defines the interface; you inject a concrete provider. See [patterns/agent-tasks.md](patterns/agent-tasks.md).

---

## One-Off Task

```typescript
import { Task, TaskExecutor, TaskType, SubprocessFailureError, TaskTimeoutError } from '@ianphil/ttasks-ts';
import { createBashHandler } from '@ianphil/ttasks-ts';

const exec = new TaskExecutor();
exec.register(TaskType.BASH, createBashHandler()); // ⚠️ no defaults — must register every type you use

const task = Task.bash('echo hello', { title: 'greet', timeout: 10 });

try {
  const result = await exec.execute(task);
  console.log(result.output.trim()); // 'hello'
  console.log(result.returncode);    // 0
} catch (err) {
  if (err instanceof SubprocessFailureError) {
    // non-zero exit or timeout; err.completion has stdout/stderr/returncode
    console.error(task.result?.error);
  }
  // task.status === TaskStatus.FAILED
}
```

---

## Workflow (DAG)

```typescript
import { Task, TaskExecutor, TaskGraph, TaskType } from '@ianphil/ttasks-ts';
import { createBashHandler } from '@ianphil/ttasks-ts';

const exec = new TaskExecutor();
exec.register(TaskType.BASH, createBashHandler());

// Build the graph
const setup   = Task.bash('mkdir -p /tmp/work',          { title: 'setup' });
const stepA   = Task.bash('echo A > /tmp/work/a.txt',    { title: 'step-a' });
const stepB   = Task.bash('echo B > /tmp/work/b.txt',    { title: 'step-b' });
const combine = Task.bash('cat /tmp/work/*.txt',         { title: 'combine' });
const cleanup = Task.bash('rm -rf /tmp/work',            { title: 'cleanup' });

const g = new TaskGraph({ title: 'my-workflow' });
g.add(setup);
g.add(stepA,   { after: [setup] });           // depends on setup
g.add(stepB,   { after: [setup] });           // depends on setup (runs in parallel with stepA)
g.add(combine, { after: [stepA, stepB] });    // waits for both
g.add(cleanup, { after: [combine], finally_: true, required: false }); // runs even if combine fails

await g.run(exec); // default: maxWorkers: 4
// Always close the store when done if you used SqliteStore
// store.close();

// Use g.ok — not g.failed.length — because failed deps leave downstream tasks BLOCKED, not FAILED
if (!g.ok) {
  for (const t of g.requiredFailed)  console.error(t.title, 'failed:',   t.result?.error);
  for (const t of g.requiredBlocked) console.error(t.title, 'never ran (blocked by:', t.blockedBy, ')');
}

console.log(combine.result?.output.trim());
```

---

## Things That Bite People

1. **Register handlers before executing.** `new TaskExecutor()` has no built-ins — the library can't know what bash implementation you want, so it ships none. Call `exec.register(TaskType.BASH, createBashHandler())` or your tasks immediately fail with `MissingHandlerError`.

2. **Check `g.ok`, not `g.failed.length`.** When a task fails, every downstream task is marked `BLOCKED` — not `FAILED`. Counting `g.failed` misses tasks that never ran. `g.ok` is false whenever anything required went wrong, for any reason.

3. **`task.result` is `null` if the task never ran.** A `BLOCKED` task has no result because it never executed. Guard with `task.result?.output` anywhere a task might have been blocked.

4. **`maxWorkers: 1` when agent tasks are in the graph.** Multiple workers means multiple Copilot turns running simultaneously on a shared session — the LLM's responses become incoherent because turns interleave. Serializing with `maxWorkers: 1` costs nothing (agent tasks dominate wall time anyway).

5. **`TaskType` is just a string — extend it freely.** `Task.custom('invoice:send', payload)` needs no cast, no enum extension. Pair it with `exec.register('invoice:send', handler)` and the task runs like any built-in.

6. **Close the `SqliteStore` when you're done.** `store.close()` flushes WAL buffers and releases the file lock. Forgetting it is harmless in short scripts but causes problems in long-running processes.

---

## Reference Files

Load these when you need more depth:

| Topic | File |
|---|---|
| Full API surface (Task, TaskExecutor, TaskGraph, SqliteStore) | [reference/api.md](reference/api.md) |
| State machine rules, BLOCKED semantics, `graph.ok` | [reference/state-machine.md](reference/state-machine.md) |
| Graph topology patterns (linear, diamond, fan-out, finally) | [patterns/workflow-shapes.md](patterns/workflow-shapes.md) |
| Agent/LLM tasks, CopilotAgentSession, shared sessions | [patterns/agent-tasks.md](patterns/agent-tasks.md) |
| Custom task types, handler registration | [patterns/custom-types.md](patterns/custom-types.md) |
