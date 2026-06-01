# Workflow Shape Patterns

Complete, copy-paste-ready patterns for common graph topologies.

---

## Linear Chain

Steps run in sequence. Each step waits for the previous.

```typescript
const a = Task.bash('step-a-command', { title: 'step-a' });
const b = Task.bash('step-b-command', { title: 'step-b' });
const c = Task.bash('step-c-command', { title: 'step-c' });

const g = new TaskGraph({ title: 'pipeline' });
g.add(a);
g.add(b, { after: [a] });
g.add(c, { after: [b] });

await g.run(exec);
```

If `a` fails → `b` and `c` are BLOCKED. `g.ok === false`.

---

## Fan-Out (Parallel Steps)

Multiple independent tasks run in parallel after a shared setup.

```typescript
const setup  = Task.bash('setup-command',  { title: 'setup' });
const worker1 = Task.bash('work-1',        { title: 'worker-1' });
const worker2 = Task.bash('work-2',        { title: 'worker-2' });
const worker3 = Task.bash('work-3',        { title: 'worker-3' });
const report  = Task.bash('report-command',{ title: 'report' });

const g = new TaskGraph({ title: 'parallel-workers' });
g.add(setup);
g.add(worker1, { after: [setup] });  // all three run in parallel
g.add(worker2, { after: [setup] });
g.add(worker3, { after: [setup] });
g.add(report,  { after: [worker1, worker2, worker3] }); // waits for all three

await g.run(exec, { maxWorkers: 4 }); // default; 3 workers run simultaneously
```

---

## Diamond

Classic fan-out / fan-in.

```typescript
const root    = Task.bash('root-cmd',    { title: 'root' });
const left    = Task.bash('left-cmd',    { title: 'left' });
const right   = Task.bash('right-cmd',  { title: 'right' });
const merge   = Task.bash('merge-cmd',  { title: 'merge' });

const g = new TaskGraph({ title: 'diamond' });
g.add(root);
g.add(left,  { after: [root] });
g.add(right, { after: [root] });
g.add(merge, { after: [left, right] }); // waits for both branches

await g.run(exec);
```

---

## Required Finally (Mandatory Teardown)

Cleanup runs after `process`, whether it succeeded or failed. Cleanup failure makes `g.ok` false.

```typescript
const setup   = Task.bash('mkdir -p /tmp/work', { title: 'setup' });
const process = Task.bash('do-work',            { title: 'process', timeout: 60 });
const cleanup = Task.bash('rm -rf /tmp/work',   { title: 'cleanup' });

const g = new TaskGraph({ title: 'with-cleanup' });
g.add(setup);
g.add(process, { after: [setup] });
g.add(cleanup, { after: [process], finally_: true }); // required=true by default

await g.run(exec);
// cleanup always runs; if it fails, g.ok is false
```

---

## Optional Finally (Best-Effort Teardown)

Cleanup runs after `process`, whether it succeeded or failed. Cleanup failure does NOT affect `g.ok`.

```typescript
const process = Task.bash('do-work',          { title: 'process' });
const notify  = Task.bash('send-notification',{ title: 'notify' });

const g = new TaskGraph({ title: 'with-notification' });
g.add(process);
g.add(notify, { after: [process], finally_: true, required: false });

await g.run(exec);
if (!g.ok) {
  // process failed — notify may or may not have run
  // g.optionalFailed tells you if notify also failed
}
```

---

## Parallel Independent Roots

No shared setup — all roots run immediately in parallel.

```typescript
const taskA = Task.bash('cmd-a', { title: 'a' });
const taskB = Task.bash('cmd-b', { title: 'b' });
const taskC = Task.bash('cmd-c', { title: 'c' });

const g = new TaskGraph({ title: 'parallel-roots' });
g.add(taskA);
g.add(taskB);
g.add(taskC);

await g.run(exec, { maxWorkers: 3 }); // all three start immediately
```

Failure of one root does NOT affect the others — they have no shared dependencies.

---

## Chained Finally Tasks

Finally tasks can depend on other finally tasks.

```typescript
const work      = Task.bash('work-cmd',   { title: 'work' });
const teardown  = Task.bash('teardown',   { title: 'teardown' });
const audit_log = Task.bash('write-log',  { title: 'audit' });

const g = new TaskGraph({ title: 'chained-finally' });
g.add(work);
g.add(teardown,  { after: [work],     finally_: true, required: true });
g.add(audit_log, { after: [teardown], finally_: true, required: false }); // optional
```

`teardown` runs after `work` (pass or fail). `audit_log` runs after `teardown` (pass or fail).

---

## Checking Results After Run

```typescript
await g.run(exec);

if (g.ok) {
  console.log('all done');
  console.log(someTask.result!.output.trim());
} else {
  for (const t of g.requiredFailed) {
    console.error(`${t.title} failed:`, t.result?.error ?? t.error);
  }
  for (const t of g.requiredBlocked) {
    console.error(`${t.title} never ran (blocked by: ${t.blockedBy})`);
  }
}
```

---

## With Durable Persistence

```typescript
import { SqliteStore } from '@ianphil/ttasks-ts';

const store = new SqliteStore({ path: './run-history.db' });
const exec  = new TaskExecutor({ store }); // auto-persists every transition
exec.register(TaskType.BASH, createBashHandler());

const g = new TaskGraph({ title: 'persistent-workflow' });
// ... add tasks ...
store.graphs.save(g); // save graph structure before running
await g.run(exec);    // each task transition is persisted
store.close();

// Later — reload and inspect
const store2 = new SqliteStore({ path: './run-history.db' });
const loaded = store2.graphs.get(g.id)!;
for (const t of loaded) {
  console.log(t.title, t.status, t.result?.output);
}
store2.close();
```
