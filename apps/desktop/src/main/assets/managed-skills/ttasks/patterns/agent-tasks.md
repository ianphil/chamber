# Agent / LLM Task Patterns

Patterns for including LLM/Copilot steps in a ttasks-ts workflow.

## Provider Requirement

`Task.prompt()` and `Task.agent()` don't work out of the box — **you must inject a `CopilotProvider`**. The library defines the interface (`CopilotProvider`, `CopilotProviderSession`) but ships no concrete implementation. You bring the implementation for your environment (GitHub Copilot SDK, OpenAI, Anthropic, a stub for testing, etc.). The provider is injected when you call `makeCopilotPromptHandler({ provider })`, `makeCopilotAgentHandler({ provider })`, or `new CopilotAgentSession({ provider, ... })`.

For testing, use the built-in `StubCopilotProvider` (see bottom of this file).

---

## Critical Rule: `maxWorkers: 1` for Agent Workflows

**Always** run graphs containing `Task.agent()` with `maxWorkers: 1`:

```typescript
await g.run(exec, { maxWorkers: 1 });
```

Why: parallel agent tasks would interleave LLM turns on the same session, producing incoherent responses. `maxWorkers: 1` serializes execution so each agent turn completes before the next starts.

---

## One-Shot Agent Task (no shared session)

Use `makeCopilotAgentHandler` when each task gets its own fresh session — no conversation history shared between tasks.

```typescript
import { Task, TaskExecutor, TaskType, makeCopilotAgentHandler } from '@ianphil/ttasks-ts';
import { MyProvider } from './my-provider.js'; // implements CopilotProvider

const provider = new MyProvider();
const exec = new TaskExecutor();
exec.register(TaskType.AGENT, makeCopilotAgentHandler({
  provider,
  model: 'gpt-5',
  timeout: 300, // seconds; null for no timeout
}));

const task = Task.agent(
  'Refactor src/utils.ts to use async/await throughout. Commit your changes.',
  { title: 'refactor-utils', timeout: 300 }
);

const result = await exec.execute(task);
console.log(result.output); // assistant's final text response
```

---

## Shared Session Across Multiple Agent Steps

Use `CopilotAgentSession` when multiple tasks need conversation continuity — the agent remembers prior turns.

```typescript
import {
  Task, TaskExecutor, TaskGraph, TaskType,
  CopilotAgentSession,
} from '@ianphil/ttasks-ts';
import { MyProvider } from './my-provider.js';

const provider = new MyProvider();

// Open one session for all agent tasks in this run
const session = new CopilotAgentSession({
  provider,
  model: 'gpt-5',
  timeout: 300,
  workingDirectory: '/path/to/repo',
});
await session.open();

try {
  const exec = new TaskExecutor();
  exec.register(TaskType.AGENT, session.handler()); // all AGENT tasks share this session

  const step1 = Task.agent('Read src/ and list all exported functions.', { title: 'explore' });
  const step2 = Task.agent('Now add JSDoc to each function you found. Commit.', { title: 'document' });
  const verify = Task.bash('pnpm typecheck', { title: 'typecheck' });

  const g = new TaskGraph({ title: 'document-exports' });
  g.add(step1);
  g.add(step2,  { after: [step1] }); // step2 sees step1's conversation history
  g.add(verify, { after: [step2] });

  await g.run(exec, { maxWorkers: 1 }); // serialize — critical for shared sessions

  if (!g.ok) {
    console.error('failed:', g.requiredFailed.map(t => t.title));
  }
} finally {
  await session.close();
}
```

### `await using` syntax (Node 22+)

```typescript
await using session = new CopilotAgentSession({ provider, model: 'gpt-5' });
await session.open();
// session.close() called automatically on block exit
```

---

## One-Shot Prompt (no tools, no agent loop)

Use `makeCopilotPromptHandler` for single-turn text completion — no tool calls, no agent loop. Faster and cheaper than a full agent turn.

```typescript
import { Task, TaskExecutor, TaskType, makeCopilotPromptHandler } from '@ianphil/ttasks-ts';

exec.register(TaskType.PROMPT, makeCopilotPromptHandler({
  provider,
  model: 'gpt-5-mini',
  timeout: 60,
}));

const summarize = Task.prompt(
  'Summarize the following diff in one sentence:\n\n' + diff,
  { title: 'summarize-diff', timeout: 30 }
);

const result = await exec.execute(summarize);
console.log(result.output); // summary text
```

---

## Mixed Bash + Agent Workflow

Common pattern: bash steps gather context, agent step acts on it, bash step verifies.

```typescript
const getHead   = Task.bash('git rev-parse HEAD',     { title: 'before-head' });
const agentStep = Task.agent('Fix the failing test in tests/. Commit.', {
  title: 'agent-fix', timeout: 600
});
const getAfter  = Task.bash('git rev-parse HEAD',     { title: 'after-head' });
const runTests  = Task.bash('pnpm test',              { title: 'verify', timeout: 120 });
const cleanup   = Task.bash('git reset --hard HEAD^', { title: 'rollback' });

const g = new TaskGraph({ title: 'test-fix' });
g.add(getHead);
g.add(agentStep, { after: [getHead] });
g.add(getAfter,  { after: [agentStep] });
g.add(runTests,  { after: [getAfter] });
// Rollback only if tests fail — check after run, not as a graph node
// (or use a finally task that checks conditions)

await g.run(exec, { maxWorkers: 1 });

// Did the agent actually commit something?
const committed = getAfter.result?.output.trim() !== getHead.result?.output.trim();
if (!g.ok && committed) {
  // run the cleanup graph separately
}
```

---

## CopilotProvider Interface

The library ships no concrete provider — you must inject one. Implement:

```typescript
interface CopilotProvider {
  createSession(options: CopilotSessionCreateOptions): Promise<CopilotProviderSession>;
}

interface CopilotProviderSession {
  sendAndWait(prompt: string, options?: CopilotSendOptions): Promise<unknown>;
  close(): Promise<void>;
  abort?(): Promise<void> | void;
}
```

`createSession` receives `{ model, tools, reasoningEffort, workingDirectory, sessionOptions, onEvent }`.
`sendAndWait` returns a raw response; `extractAssistantText(response)` (exported from ttasks-ts) pulls out the assistant text content.

The library ships `StubCopilotProvider` for testing:

```typescript
import { StubCopilotProvider } from '@ianphil/ttasks-ts';

const stub = new StubCopilotProvider();
stub.setResponder(async (prompt) => `echo: ${prompt}`);
exec.register(TaskType.AGENT, makeCopilotAgentHandler({ provider: stub }));
```
