# State Machine Reference

## States

| State | Meaning |
|---|---|
| `PENDING` | Created, not yet run |
| `RUNNING` | Handler executing |
| `SUCCEEDED` | Handler returned successfully — **sink, immutable** |
| `FAILED` | Handler threw — retryable |
| `CANCELLED` | Explicitly cancelled — **sink** |
| `BLOCKED` | A required upstream dependency failed/cancelled/blocked — never ran |

## Allowed Transitions

```
PENDING  → RUNNING, FAILED, CANCELLED, BLOCKED
RUNNING  → SUCCEEDED, FAILED, CANCELLED
FAILED   → RUNNING (retry), CANCELLED
BLOCKED  → RUNNING (carryover retry), CANCELLED
SUCCEEDED → (none — sink)
CANCELLED → (none — sink)
```

`SUCCEEDED` and `CANCELLED` are permanent sinks. No transition out.

## What Happens on Each Transition

**→ RUNNING**: clears prior `result`, `blockedBy`, and `error` so a retry starts clean.

**→ SUCCEEDED**: clears `error`. Task becomes immutable — public field writes throw `TaskMutationError`.

**→ FAILED**: stores `error` message. Retryable — the executor can transition back to RUNNING.

**→ BLOCKED**: stores `blockedBy` (id of the direct dependency that caused the block). No result is attached. Task never ran.

**→ CANCELLED**: does not erase a prior `error`. Idempotent via `task.cancel()`.

---

## BLOCKED Semantics

BLOCKED is the most commonly misunderstood state.

**When it happens**: during `graph.run()`, if a task's required dependency enters FAILED, CANCELLED, or BLOCKED, every downstream task is immediately marked BLOCKED. It never enters RUNNING.

**What it means for `graph.ok`**:
```typescript
// WRONG — misses BLOCKED tasks
if (g.failed.length > 0) handleError();

// RIGHT — covers all bad outcomes
if (!g.ok) {
  console.error('failed:', g.requiredFailed.map(t => t.title));
  console.error('never ran:', g.requiredBlocked.map(t => t.title));
}
```

**`task.result` for a BLOCKED task is `null`**. Never ran means no result.

**`task.blockedBy`** is the id of the *direct* dependency that caused the block, not necessarily the root cause. To trace to the root, follow `blockedBy` chains through the graph.

**Example**: A → B → C → D. If B fails:
- C is BLOCKED with `blockedBy = B.id`
- D is BLOCKED with `blockedBy = C.id` (C is C's direct bad parent)

---

## finally_ Tasks

Finally tasks use a different readiness rule: they wait for all listed deps to be **inactive** (not just SUCCEEDED).

| dep status | normal task | finally_ task |
|---|---|---|
| SUCCEEDED | ✅ ready | ✅ ready |
| FAILED | ❌ never runs (BLOCKED) | ✅ ready |
| CANCELLED | ❌ never runs (BLOCKED) | ✅ ready |
| BLOCKED | ❌ never runs (BLOCKED) | ✅ ready |

```typescript
// cleanup runs regardless of whether process succeeded or failed
g.add(cleanup, { after: [process], finally_: true, required: false });
```

`required: false` means: cleanup can itself fail without affecting `g.ok`. Use this for best-effort teardown (remove temp files, send notification).

`required: true` (default): cleanup failure does count against `g.ok`. Use this for mandatory post-steps.

---

## Carryover BLOCKED

If a task is BLOCKED when `graph.run()` starts (left over from a previous run), it is **eligible for retry** in the new run. The scheduler treats it the same as FAILED — it can transition back to RUNNING if its parents succeed this time.

Tasks that become BLOCKED *during* a run stay BLOCKED for that run — they are not retried within the same `run()` call.

This means you can safely call `graph.run()` multiple times on the same graph. Already-SUCCEEDED tasks count as satisfied dependencies. Previously-BLOCKED tasks get another chance.

---

## `graph.ok` Definition

```
graph.ok === true  iff:
  - graph.run() has been called at least once, AND
  - every required task (required=true, which is the default) has status SUCCEEDED, AND
  - no required task has an executor error in graph.errors
```

Optional tasks (`required: false`, only valid on `finally_` tasks) do not contribute to `graph.ok`. Check `graph.optionalFailed` separately if you care.

---

## TaskStatus Enum Values

```typescript
TaskStatus.PENDING    === 'pending'
TaskStatus.RUNNING    === 'running'
TaskStatus.SUCCEEDED  === 'succeeded'
TaskStatus.FAILED     === 'failed'
TaskStatus.CANCELLED  === 'cancelled'
TaskStatus.BLOCKED    === 'blocked'
```
