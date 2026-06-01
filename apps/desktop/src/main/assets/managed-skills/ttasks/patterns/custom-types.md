# Custom Task Types

ttasks-ts uses an **open string union** for `TaskType`. Any non-empty string is a valid task type. This is the primary extensibility point — no subclassing, no plugins.

---

## Basic Pattern

```typescript
import { Task, TaskExecutor, TaskContext } from '@ianphil/ttasks-ts';

const exec = new TaskExecutor();

// 1. Register a handler for your type string
exec.register('slack:notify', async (ctx: TaskContext) => {
  const { channel, message } = JSON.parse(ctx.payload);
  await sendSlackMessage(channel, message);
  return `sent to ${channel}`; // string return → result.output
});

// 2. Create a task with that type
const notify = Task.custom('slack:notify', JSON.stringify({
  channel: '#deploys',
  message: 'Deploy complete',
}), { title: 'notify-slack' });

// 3. Execute normally
const result = await exec.execute(notify);
console.log(result.output); // 'sent to #deploys'
```

---

## Type Checking

The type system preserves autocomplete for the four built-ins while accepting arbitrary strings:

```typescript
// All valid — no cast needed
new Task('webhook',        '{}');
new Task('slack:notify',   '{}');
new Task(TaskType.BASH,    'echo hi');
Task.custom('http:get',    'https://example.com');

exec.register('webhook',   handler);
exec.register(TaskType.BASH, createBashHandler());
exec.isRegistered('webhook'); // boolean
```

---

## Payload Convention

`payload` is always a `string`. Use `JSON.stringify` / `JSON.parse` for structured data:

```typescript
// Encode
const task = Task.custom('db:query', JSON.stringify({
  sql: 'SELECT count(*) FROM orders WHERE status = ?',
  params: ['pending'],
}), { title: 'count-pending-orders' });

// Decode inside handler
exec.register('db:query', async (ctx) => {
  const { sql, params } = JSON.parse(ctx.payload) as { sql: string; params: string[] };
  const rows = await db.query(sql, params);
  return JSON.stringify(rows);
});
```

---

## Using `task.metadata` for Domain Data

`metadata` is a frozen JSON bag for data that doesn't belong in `payload` (handler input). It survives SQLite persistence.

```typescript
const task = Task.custom('report:generate', reportConfig, {
  title: 'monthly-report',
  metadata: {
    ownerId: 'user-123',
    reportType: 'monthly',
    sourceGraphId: parentGraph.id,
  },
});

// Handlers can read metadata but should not depend on specific keys
exec.register('report:generate', async (ctx) => {
  console.log('owner:', ctx.task.metadata.ownerId);
  // ... generate report using ctx.payload ...
});

// Metadata survives a SQLite roundtrip
const reloaded = store.tasks.get(task.id)!;
console.log(reloaded.metadata.ownerId); // 'user-123'
```

---

## Mixing Custom and Built-in Types in One Graph

```typescript
const exec = new TaskExecutor();
exec.register(TaskType.BASH, createBashHandler());
exec.register('validate:schema', schemaValidationHandler);
exec.register('notify:slack', slackHandler);

const build    = Task.bash('pnpm build',              { title: 'build' });
const validate = Task.custom('validate:schema', schemaPayload, { title: 'validate' });
const deploy   = Task.bash('kubectl apply -f k8s/',   { title: 'deploy' });
const notify   = Task.custom('notify:slack', JSON.stringify({
  channel: '#ops', message: 'Deployed!'
}), { title: 'notify' });

const g = new TaskGraph({ title: 'deploy-pipeline' });
g.add(build);
g.add(validate, { after: [build] });
g.add(deploy,   { after: [validate] });
g.add(notify,   { after: [deploy], finally_: true, required: false });

await g.run(exec);
```

---

## When to Use Custom Types vs Bash

| Use custom type when | Use `Task.bash` when |
|---|---|
| The operation has typed inputs/outputs | The operation is a shell command |
| You want `metadata` for domain tagging | The payload is just a command string |
| The handler calls a JS/TS API (SDK, DB) | You need pipes, redirection, shell features |
| You want handler logic tested in isolation | A one-liner script is fine |
| The operation is not a subprocess | You need process stdout/stderr/returncode |

---

## Handler Return Values

The handler return value is normalized into `task.result.output`:

| Handler returns | `result.output` | `result.returncode` |
|---|---|---|
| `string` | the string | `null` |
| `{ stdout, stderr, returncode }` | `stdout` | `returncode` |
| anything else | `''` | `null` |

Throwing any error → task FAILED. Throwing `TaskCancelled` → task CANCELLED (not retried).
