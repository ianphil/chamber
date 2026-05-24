# ttasks TypeScript implementation port TODO

Track the implementation port from Python `ttasks` into Chamber's isolated TypeScript module.

Source:

```text
/home/cip/src/ttasks/src/ttasks/
```

Target:

```text
/home/cip/src/chamber/packages/services/src/tasks/
```

Test checklist:

```text
/home/cip/src/chamber/tests_todo.md
```

Legend:

- [x] not ported
- [x] WIP / partially ported / failing validation
- [x] ported and validated
- [n/a] intentionally omitted, with reason

## Module status

- [x] `task.py` -> `task.ts`
- [x] `events.py` -> `events.ts`
- [x] `ledger.py` -> `ledger.ts`
- [x] `executor.py` -> `executor.ts`
- [x] `workflow.py` -> `workflow.ts`
- [x] `__init__.py` -> `index.ts`

> Note: an initial WIP implementation exists. Treat it as scaffold until each module is reviewed against the Python source and validated.

## `task.py` -> `task.ts`

- [x] `TaskStatus` lifecycle states
- [x] `TaskType` values
- [x] centralized allowed-transition table
- [x] `Task` constructor validation
- [x] immutable/read-only task ID
- [x] read-only task status
- [x] `can_transition_to` / `canTransitionTo`
- [x] `transition_to` / `transitionTo`
- [x] `cancel` idempotence
- [x] cancellation preserves existing error
- [x] DONE task public-field immutability
- [x] FAILED task remains mutable for retry
- [x] `TaskResult` frozen/immutable result record
- [x] `TaskResult.from_raw` / `fromRaw` normalization
- [x] subprocess/process result normalization
- [x] representation/debug string behavior
- [x] TypeScript idiom review
- [x] task tests pass

## `events.py` -> `events.ts`

- [x] `TaskEventType` values
- [x] `TaskEvent` shape
- [x] `EventBus.subscribe`
- [x] idempotent unsubscribe callback
- [x] reject non-callable subscribers
- [x] `EventBus.emit`
- [x] subscriber errors are isolated from execution
- [x] subscriber errors are recorded
- [x] `errors` returns defensive copy
- [x] TypeScript idiom review
- [x] events tests pass

## `ledger.py` -> `ledger.ts`

- [x] `TaskLedger` stores only `Task` instances
- [x] task ID consistency check
- [x] `TaskLedger.get` missing-key behavior
- [x] insertion-order iteration
- [x] `TaskLedger.delete`
- [x] `TaskLedger.cancel`
- [x] `TaskLedger.has`
- [x] `TaskLedger.size`
- [x] `TaskLedger` representation/debug string
- [x] `GraphLedger` stores only `TaskGraph` instances
- [x] graph ID consistency check
- [x] `GraphLedger.get` missing-key behavior
- [x] insertion-order iteration
- [x] `GraphLedger.delete`
- [x] `GraphLedger.has`
- [x] `GraphLedger.size`
- [x] `GraphLedger` representation/debug string
- [x] TypeScript idiom review
- [x] ledger tests pass
- [x] ledger deletion tests pass
- [x] graph ledger tests pass

## `executor.py` -> `executor.ts`

- [x] `TaskCancelled`
- [x] `TaskExecutionError`
- [x] `TaskTimeoutError`
- [x] `TaskContext` read-only task view
- [x] `TaskContext` read-only upstream refs
- [x] `TaskContext.raise_if_cancelled` / `raiseIfCancelled`
- [x] handler registration validation
- [x] execute rejects non-runnable tasks before handler call
- [x] execute rejects missing handlers before task starts
- [x] execute transitions PENDING/FAILED -> RUNNING
- [x] successful execution attaches `TaskResult`
- [x] successful execution transitions to DONE
- [x] failed execution transitions to FAILED
- [x] failed execution stores task error
- [x] cancelled execution transitions to CANCELLED
- [x] cancelled execution attaches cancelled `TaskResult`
- [x] event emission order and payloads
- [x] retry after failure semantics
- [x] previous error clears on successful retry
- [x] arbitrary handler return values preserved as raw result
- [x] process command execution
- [x] shell/BASH handler
- [x] PowerShell handler
- [x] process registry / `isRunning`
- [x] timeout termination
- [x] timeout result preserves partial stdout/stderr
- [x] non-zero process result preserves stdout/stderr/return code
- [x] cancellation terminates active process
- [x] process termination escalation behavior
- [x] default executor registrations
- [x] prompt handler model/timeout validation
- [x] prompt handler no-tools session behavior
- [x] agent handler model validation
- [x] agent handler tools-enabled session behavior
- [x] SDK/fake-SDK test seams for isolated tests
- [x] TypeScript idiom review
- [x] executor tests pass

## `workflow.py` -> `workflow.ts`

- [x] graph identity
- [x] graph title validation
- [x] graph created-at metadata
- [x] graph task registration
- [x] graph dependency lookup
- [x] graph contains/has
- [x] graph iteration in insertion order
- [x] graph size
- [x] graph representation/debug string
- [x] graph owns or reuses `TaskLedger`
- [x] validation rejects unregistered deps
- [x] validation rejects cycles
- [x] async DAG scheduler
- [x] max worker/concurrency validation
- [x] direct upstream refs passed to handlers
- [x] only direct upstream refs passed
- [x] empty graph run behavior
- [x] single-node execution
- [x] linear dependency execution
- [x] diamond/parallel execution
- [x] executor/setup errors recorded
- [x] executor/setup errors block descendants
- [x] task failures block descendants
- [x] independent branches continue after failure
- [x] run terminates after failure without hanging
- [x] `add_finally` / `addFinally`
- [x] finally tasks run after failed/blocked dependencies
- [x] optional finally tasks via `required=false`
- [x] required finally failures affect `ok`
- [x] blocked view
- [x] failed view
- [x] cancelled view
- [x] succeeded view
- [x] ok semantics
- [x] rerun semantics with DONE dependencies
- [x] pending descendant added after DONE dependency can run
- [x] roots view
- [x] leaves view
- [x] TypeScript idiom review
- [x] workflow tests pass

## `__init__.py` -> `index.ts`

- [x] flat public export surface
- [x] exported names match public API tests
- [x] exports point to canonical module objects
- [x] TypeScript idiom review
- [x] public API tests pass

## Validation

- [x] `npm test -- --run packages/services/src/tasks`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [x] no unintended integration with cron/a2a/chatroom/IPC/UI
- [x] working tree reviewed

## Notes

- The port should remain isolated under `packages/services/src/tasks/`.
- Chamber should not consume this module yet.
- Prefer behavior parity with `ttasks` tests over premature Chamber integration.
- Some Python-specific details need TS/Node equivalents, especially subprocess handling, private fields, and read-only maps.
