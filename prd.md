# PRD: Chamber Automation Scripts with ttasks-ts + Cron

## Summary

Chamber should let minds create, run, and schedule TypeScript automation scripts that use `@ianphil/ttasks-ts` to define one-off tasks or full task graphs. A Chamber-managed `automation` skill will teach minds this contract. Chamber cron will gain a new script-backed job type that runs these TypeScript files on a schedule.

The core product idea is simple:

> A mind writes one TypeScript file inside the mind, that file is the workflow, and Chamber cron can schedule it.

There should be no JSON graph DSL, no custom workflow materializer, and no separate generic ttasks skill required for Chamber minds. Agents are already good at writing code; Chamber should give them a narrow runtime contract and a managed skill that explains how to use it.

## Goals

- Let Chamber minds create reusable TypeScript automation files stored in the mind.
- Let those scripts use `@ianphil/ttasks-ts` for single tasks, task graphs, task status, dependency handling, and SQLite persistence.
- Let cron schedule those scripts using a new `script` cron job type.
- Ship one Chamber-managed `automation` skill that teaches the mind how to write and schedule these scripts.
- Keep v1 minimal and reliable: bash tasks, graphs, persistence, and cron scheduling.
- Preserve the existing cron job types (`prompt`, `shell`, `webhook`, `notification`) and their behavior.

## Non-Goals

- Do not introduce a JSON graph/workflow specification.
- Do not build a custom workflow engine in Chamber; ttasks-ts is the workflow engine.
- Do not support `Task.prompt()` or `Task.agent()` inside automation scripts in v1.
- Do not add Chamber-specific custom task handlers in v1 (`chamber:prompt`, `chamber:notification`, etc.).
- Do not run generated TypeScript in-process via `eval`, `vm`, or dynamic import into the Electron main process.
- Do not require minds to install npm packages manually for the script runtime.

## Current State

Chamber cron currently supports four atomic job types:

- `prompt`
- `shell`
- `webhook`
- `notification`

Cron scheduling is handled by `croner` in `Scheduler.ts`. Actual job execution is handled directly by `JobRunner.ts` using `execFile`, `fetch`, the A2A `TaskManager`, and the `Notifier` port.

`@ianphil/ttasks-ts` is already present in Chamber and used by cron as a persistence layer through `TTasksCronRunStore`. Today, cron run history is represented as ttasks `Task` records in `.chamber/runs/ttasks.db`, but cron does not execute jobs through ttasks.

Chamber also already has a managed skill system. The Lens skill is bundled at:

```text
apps/desktop/src/main/assets/managed-skills/lens/SKILL.md
```

and installed into minds under:

```text
.github/skills/lens/
```

via `bootstrapMindCapabilities()` in `MindBootstrap.ts`.

## Proposed User Experience

A user asks a mind:

> Run my test suite every weekday morning and keep a history of which step failed.

The mind uses the managed `automation` skill, writes:

```text
.chamber/automation/weekday-tests.ts
```

The script imports `@ianphil/ttasks-ts`, builds a graph, persists results to Chamber's ttasks DB, and exits 0/1 depending on success.

Then the mind schedules it with `cron_create`:

```json
{
  "name": "Weekday tests",
  "schedule": "0 9 * * 1-5",
  "type": "script",
  "payload": {
    "path": ".chamber/automation/weekday-tests.ts"
  }
}
```

When cron fires, Chamber runs the TypeScript script from the mind root with Chamber-provided environment variables.

## Automation Script Contract

### Location

Reusable scheduled automation scripts must live under:

```text
.chamber/automation/<name>.ts
```

Scripts should use stable, lowercase, hyphenated names where possible.

### Execution

Chamber runs scripts as subprocesses from the mind root. The v1 execution model should be equivalent to:

```bash
tsx .chamber/automation/<name>.ts
```

Chamber owns the `tsx` runtime. Minds should not be asked to install `tsx` or `@ianphil/ttasks-ts` themselves.

### Environment Variables

Script jobs receive:

```text
CHAMBER_MIND_ID      active mind id
CHAMBER_MIND_PATH    absolute path to the mind root
CHAMBER_TTASKS_DB    absolute path to .chamber/runs/ttasks.db
```

Additional env values may be provided through the cron job payload in `payload.env`, but Chamber-provided variables must take precedence over user-provided values.

### Standard Script Shape

A typical v1 script should look like:

```ts
import {
  SqliteStore,
  Task,
  TaskExecutor,
  TaskGraph,
  TaskType,
} from '@ianphil/ttasks-ts';
import { createBashHandler } from '@ianphil/ttasks-ts';

const store = new SqliteStore({ path: process.env.CHAMBER_TTASKS_DB! });
const exec = new TaskExecutor({ store });
exec.register(TaskType.BASH, createBashHandler());

const test = Task.bash('pnpm test', { title: 'test', timeout: 120 });
const build = Task.bash('pnpm build', { title: 'build', timeout: 120 });

const graph = new TaskGraph({ title: 'weekday-tests' });
graph.add(test);
graph.add(build, { after: [test] });

try {
  await graph.run(exec, { maxWorkers: 1 });

  for (const task of graph) {
    console.log(`${task.title}: ${task.status}`);
    if (task.result?.output) console.log(task.result.output);
    if (task.result?.error) console.error(task.result.error);
  }
} finally {
  store.close();
}

process.exit(graph.ok ? 0 : 1);
```

Important rules:

- Register handlers before executing tasks.
- Use `SqliteStore` at `CHAMBER_TTASKS_DB` for persistence.
- Always call `store.close()` before exit.
- Use `graph.ok` to decide workflow success, not `graph.failed.length`.
- Exit `0` on success and nonzero on failure.

## Cron API Changes

### New Cron Job Type

Add `script` to `CronJobType`:

```ts
export type CronJobType =
  | 'prompt'
  | 'shell'
  | 'webhook'
  | 'notification'
  | 'script';
```

### Payload

```ts
export interface ScriptJobPayload {
  path: string;
  args?: string[];
  env?: Record<string, string>;
}
```

Add `ScriptCronJob` and include it in `CronJob`, `CronJobPayload`, and `CreateCronJobInput`.

### Tool Schema

Update `cron_create` so `type` accepts `script` and `payload` documents:

```json
{
  "path": ".chamber/automation/daily-check.ts",
  "args": [],
  "env": {}
}
```

### Validation

Service-level validation should enforce:

- `payload.path` is a non-empty string.
- path is relative, not absolute.
- path does not contain `..` segments.
- path ends with `.ts`.
- path is under `.chamber/automation/`.
- referenced script exists before execution.

The managed skill should teach these rules, but Chamber must enforce them.

## JobRunner Changes

Add a `script` case to `JobRunner.run()`:

```ts
case 'script':
  return this.runScriptJob(mindId, mindPath, job);
```

`runScriptJob()` should:

1. Resolve and validate the script path under the mind root.
2. Run the script using Chamber-owned `tsx`.
3. Set `cwd` to the mind root.
4. Inject `CHAMBER_MIND_ID`, `CHAMBER_MIND_PATH`, and `CHAMBER_TTASKS_DB`.
5. Apply the cron job timeout.
6. Return:
   - `completed` when the process exits 0.
   - `failed` when the process exits nonzero.
   - `timed-out` when killed by timeout.
7. Capture stdout/stderr into the cron run record output/error fields.

Pseudo-code:

```ts
private async runScriptJob(
  mindId: string,
  mindPath: string,
  job: Extract<CronJob, { type: 'script' }>,
): Promise<{ status: CronRunStatus; output?: string; error?: string }> {
  const timeoutMs = job.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const scriptPath = resolveAutomationScriptPath(mindPath, job.payload.path);
  const ttasksDb = path.join(mindPath, '.chamber', 'runs', 'ttasks.db');

  try {
    const result = await execFileAsync(resolveTsxBinary(), [scriptPath, ...(job.payload.args ?? [])], {
      cwd: mindPath,
      timeout: timeoutMs,
      windowsHide: true,
      env: {
        ...process.env,
        ...(job.payload.env ?? {}),
        CHAMBER_MIND_ID: mindId,
        CHAMBER_MIND_PATH: mindPath,
        CHAMBER_TTASKS_DB: ttasksDb,
      },
    });
    return {
      status: 'completed',
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    return {
      status: error.killed ? 'timed-out' : 'failed',
      output: [error.stdout, error.stderr].filter(Boolean).join('\n').trim(),
      error: error.message,
    };
  }
}
```

## Result Storage

V1 result behavior should be simple:

- Cron records the script process status, stdout, stderr, and error exactly like a shell job.
- The script itself persists rich ttasks task/graph data to `CHAMBER_TTASKS_DB`.
- `cron_history` continues to return flat cron run records in v1.

A later version may enrich `cron_history` by reading graph/task details from `CHAMBER_TTASKS_DB` and surfacing per-node summaries.

## Managed Skill: `automation`

Chamber should ship one managed skill for this feature, installed into every mind.

### Location in Repo

```text
apps/desktop/src/main/assets/managed-skills/automation/
  SKILL.md
  references/
    ttasks.md
    cron.md
    examples.md
```

### Installed Location in Minds

```text
.github/skills/automation/
  SKILL.md
  .chamber-skill.json
  references/
    ttasks.md
    cron.md
    examples.md
```

### Suggested Frontmatter

```yaml
---
name: automation
version: 1.0.0
description: Create, run, debug, and schedule Chamber automations using TypeScript and @ianphil/ttasks-ts. Use this skill whenever the user wants recurring jobs, cron jobs, scheduled tasks, automated checks, workflows, pipelines, chained steps, parallel tasks, cleanup after failure, task graphs, one-off tracked task execution, or asks to “run this every day/hour/week” or “do X then Y then Z.” Always use this skill before creating or editing files under .chamber/automation or creating script-backed cron jobs.
---
```

### Skill Content Requirements

The first screenful of `SKILL.md` should include the non-negotiable contract:

- Put scheduled automations under `.chamber/automation/<name>.ts`.
- Use TypeScript and `@ianphil/ttasks-ts`.
- Use `SqliteStore` at `process.env.CHAMBER_TTASKS_DB!`.
- Register `TaskType.BASH` with `createBashHandler()`.
- Close the store.
- Exit 0 when successful, nonzero when failed.
- Schedule with `cron_create` using `type: "script"`.
- Do not use `Task.prompt()` or `Task.agent()` in v1 automation scripts.

### Managed Skill Metadata

Follow the Lens skill pattern with `.chamber-skill.json`:

```json
{
  "name": "automation",
  "version": "1.0.0",
  "managedBy": "chamber",
  "contentSha256": "<sha256>",
  "capabilities": [
    "chamber-automation-v1",
    "ttasks-ts-v1",
    "cron-script-jobs"
  ]
}
```

## Bootstrap Changes

Add an `installAutomationSkill(mindPath)` function in `MindBootstrap.ts`, mirroring `installLensSkill()`.

Update:

```ts
export function bootstrapMindCapabilities(mindPath: string): void {
  seedLensDefaults(mindPath);
  installLensSkill(mindPath);
  installAutomationSkill(mindPath);
}
```

The install/upgrade policy should match Lens:

- Install when missing.
- Upgrade managed unmodified skills when version/content changes.
- Preserve locally edited managed skills.
- Preserve unmanaged skills.
- Write `.chamber-skill.json` with version and content hash.

## Packaging

Ensure the new asset directory is included in packaged desktop builds, following the Lens skill packaging path.

## Tests

### Cron Types and Validation

- Can create a `script` cron job with a valid `.chamber/automation/*.ts` path.
- Rejects missing `payload.path`.
- Rejects absolute paths.
- Rejects paths containing `..`.
- Rejects paths outside `.chamber/automation/`.
- Rejects paths that do not end in `.ts`.

### JobRunner

- Runs a script job and returns `completed` on exit 0.
- Returns `failed` on exit nonzero.
- Returns `timed-out` when the subprocess is killed by timeout.
- Injects `CHAMBER_MIND_ID`, `CHAMBER_MIND_PATH`, and `CHAMBER_TTASKS_DB`.
- Runs with `cwd` set to the mind root.

### Cron Tools

- `cron_create` schema includes `script` and documents the payload.
- `cron_run_now` works for script jobs.
- `cron_history` records script job outputs.

### Managed Skill

- Installs `automation` skill when missing.
- Upgrades managed unmodified skill.
- Preserves locally edited managed skill.
- Preserves unmanaged skill.
- Reads bundled asset in both dev and packaged resource paths.

### Manual Mind Conversation

Use a real mind and ask:

> Create a daily automation that runs `pnpm test` and `pnpm build`, records which step failed, and schedules it every weekday at 9am.

Expected behavior:

- Mind loads the `automation` skill.
- Mind writes `.chamber/automation/weekday-check.ts`.
- Script uses `@ianphil/ttasks-ts`, `SqliteStore`, `TaskGraph`, and `createBashHandler()`.
- Mind schedules it with `cron_create` using `type: "script"`.
- `cron_run_now` can execute it immediately.

## V1 Scope

Supported:

- `Task.bash()`
- `TaskGraph`
- `TaskExecutor`
- `SqliteStore`
- `createBashHandler()`
- regular TypeScript logic in the script
- scheduling via cron `type: "script"`

Deferred:

- `Task.prompt()`
- `Task.agent()`
- Chamber-specific ttasks handlers
- local HTTP bridge back into Chamber
- per-node graph summaries in `cron_history`
- script editor UI

## Open Questions

1. What is the exact runtime mechanism for `tsx` in packaged Electron builds?
2. Should `payload.env` be allowed in v1, or should environment be fixed to reduce surprise?
3. Should scripts be allowed to import local project files from the mind root?
4. Should v1 expose a one-off `script_run` tool, or should users create disabled script cron jobs and call `cron_run_now`?
5. Should cron history show a link/reference to the ttasks DB graph ID in v1, even if it does not surface per-node summaries yet?
