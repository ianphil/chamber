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

import type {
  AcpPermissionOptionId,
  JobSnapshot,
  JobStore,
} from 'chamber-copilot';

const SCOPED_ID_SEPARATOR = ':';

function unknownJob(scopedJobId: string): Error {
  return new Error(`Unknown job_id: ${scopedJobId}`);
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
  }): Promise<{ readonly jobId: string; readonly sessionId: string }> {
    const result = await this.inner.delegate(params);
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

  list(filter?: { readonly status?: string; readonly cwd?: string }): JobSnapshot[] {
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
    const sep = scopedJobId.indexOf(SCOPED_ID_SEPARATOR);
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
