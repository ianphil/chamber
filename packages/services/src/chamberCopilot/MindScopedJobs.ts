// MindScopedJobs — per-mind adapter over chamber-copilot's JobStore.
//
// Why this exists:
//   The shared JobStore handed back by chamber-copilot has no notion of
//   "which mind asked". If two minds enable chamber-copilot at the same
//   time, the underlying store is one global pool — any mind can read,
//   approve, or cancel any other mind's jobs through cli_status,
//   cli_respond, cli_approve, cli_cancel, or cli_list.
//
//   This adapter is the trust boundary: it namespaces every job_id
//   exposed to a mind as `${mindId}:${realJobId}` and rejects any
//   operation against a job_id that doesn't bear this mind's prefix
//   AND isn't recorded as owned by this mind. A probing mind cannot
//   distinguish between "wrong mind" and "non-existent job" — both
//   surface the same UnknownJob-shaped error string.
//
//   The adapter intentionally satisfies the same call shape as
//   chamber-copilot's `JobStore`, so it slots into `createAcpTools`
//   without changes to the chamber-copilot tool surface.
//
//   Permission posture (chamber-copilot >= 0.5.11): each delegated job
//   carries a `permissionMode` ('safe' | 'yolo') chosen per-call by the
//   delegating mind via `cli_delegate({ permission_mode: ... })`. This
//   adapter is mode-agnostic — it forwards `permissionMode` straight
//   through to the underlying JobStore on `delegate` and `list` filter,
//   and preserves it on `status` snapshots so the mind can audit which
//   posture each of its jobs is running under.

import type {
  AcpPermissionOptionId,
  JobListFilter,
  JobSnapshot,
  JobStore,
  PermissionMode,
} from 'chamber-copilot';

const SCOPED_ID_SEPARATOR = ':';

function unknownJob(scopedJobId: string): Error {
  return new Error(`Unknown job_id: ${scopedJobId}`);
}

// Thrown when the inner JobStore.delegate returns a rawJobId that violates
// the encoding invariant. Distinct error shape (NOT UnknownJob) so callers
// can tell "I asked for a job that does not exist" apart from "the inner
// store handed us a malformed id". See `unscope` below for why the
// invariant matters.
class MindScopedJobsInvariantError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MindScopedJobsInvariantError';
  }
}

export class MindScopedJobs {
  private readonly ownedJobIds = new Set<string>();

  constructor(
    private readonly inner: JobStore,
    private readonly mindId: string,
  ) {}

  async delegate(params: {
    readonly cwd: string;
    readonly prompt: string;
    readonly permissionMode?: PermissionMode;
  }): Promise<{ readonly jobId: string; readonly sessionId: string }> {
    const result = await this.inner.delegate(params);
    // INVARIANT (issue #261): the unscope split below uses
    // `lastIndexOf(SCOPED_ID_SEPARATOR)`, which only recovers the
    // (mindId, rawJobId) pair correctly if the rawJobId itself does not
    // contain the separator. The default chamber-copilot JobStore uses
    // `randomUUID()` (no colons) so this holds in production today, but
    // `JobStoreOptions.idFactory` is a public extension point — a future
    // custom factory that returns colon-containing ids would silently
    // shift the unscope boundary. Reject at the boundary so the failure
    // is loud and immediate, not a delayed "Unknown job_id" miles away.
    if (result.jobId.includes(SCOPED_ID_SEPARATOR)) {
      let cancelFailure: unknown;
      try {
        await this.inner.cancel(result.jobId);
      } catch (error) {
        cancelFailure = error;
      }
      throw new MindScopedJobsInvariantError(
        `MindScopedJobs invariant violated: inner JobStore returned a rawJobId containing the scope separator '${SCOPED_ID_SEPARATOR}' (jobId=${JSON.stringify(result.jobId)}). The scope/unscope split assumes rawJobIds do not contain '${SCOPED_ID_SEPARATOR}'. Use a different JobStoreOptions.idFactory.`,
        cancelFailure === undefined ? undefined : { cause: cancelFailure },
      );
    }
    this.ownedJobIds.add(result.jobId);
    return { jobId: this.scope(result.jobId), sessionId: result.sessionId };
  }

  async respond(scopedJobId: string, prompt: string): Promise<void> {
    await this.inner.respond(this.unscope(scopedJobId), prompt);
  }

  async approve(
    scopedJobId: string,
    approvalId: string,
    optionId: AcpPermissionOptionId,
  ): Promise<void> {
    await this.inner.approve(this.unscope(scopedJobId), approvalId, optionId);
  }

  async cancel(scopedJobId: string): Promise<void> {
    await this.inner.cancel(this.unscope(scopedJobId));
  }

  status(scopedJobId: string): JobSnapshot {
    const raw = this.unscope(scopedJobId);
    const snap = this.inner.status(raw);
    return { ...snap, jobId: this.scope(snap.jobId) };
  }

  list(filter?: JobListFilter): JobSnapshot[] {
    return this.inner
      .list(filter)
      .filter((snap) => this.ownedJobIds.has(snap.jobId))
      .map((snap) => ({ ...snap, jobId: this.scope(snap.jobId) }));
  }

  /**
   * Cancel and forget every job owned by this mind.
   *
   * Called from ChamberCopilotService.releaseMind so that delegated work
   * doesn't outlive its owning mind. Failures are swallowed because the
   * underlying job may already be terminal — releasing a mind must never
   * throw. After this resolves, this adapter is dead: subsequent
   * operations against any prior job_id will report UnknownJob.
   */
  async releaseAll(): Promise<void> {
    const jobs = Array.from(this.ownedJobIds);
    this.ownedJobIds.clear();
    for (const raw of jobs) {
      try {
        await this.inner.cancel(raw);
      } catch {
        // Already terminal, never started, or otherwise gone — by design.
      }
    }
  }

  private scope(rawJobId: string): string {
    return `${this.mindId}${SCOPED_ID_SEPARATOR}${rawJobId}`;
  }

  private unscope(scopedJobId: string): string {
    if (typeof scopedJobId !== 'string' || scopedJobId.length === 0) {
      throw unknownJob(scopedJobId);
    }
    // INVARIANT (issue #261): split on the LAST separator, not the first.
    //
    //   Real Chamber mindIds are derived from a directory basename plus a
    //   4-char hex suffix (see generateMindId.ts). On Linux/macOS a
    //   basename can legally contain ':', so a mindId like
    //   'foo:bar-abcd' is realistic. `indexOf(':')` would split that at
    //   position 3 and reject every legitimate scoped id as foreign.
    //
    //   `lastIndexOf(':')` correctly recovers the (mindId, rawJobId) pair
    //   under the complementary invariant that rawJobIds do not contain
    //   ':'. That invariant is enforced eagerly in `delegate()` above, so
    //   if a future `JobStoreOptions.idFactory` violates it the failure
    //   surfaces at write time with a distinct error, not silently here.
    const sep = scopedJobId.lastIndexOf(SCOPED_ID_SEPARATOR);
    if (sep <= 0 || sep === scopedJobId.length - 1) {
      throw unknownJob(scopedJobId);
    }
    const prefix = scopedJobId.slice(0, sep);
    const raw = scopedJobId.slice(sep + 1);
    if (prefix !== this.mindId || !this.ownedJobIds.has(raw)) {
      throw unknownJob(scopedJobId);
    }
    return raw;
  }
}
