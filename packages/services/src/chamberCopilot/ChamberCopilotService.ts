// ChamberCopilotService — exposes chamber-copilot's `cli_*` ACP tool surface
// to chamber minds via the ChamberToolProvider seam.
//
// Pattern mirrors CanvasService: the service owns its underlying
// infrastructure (one shared `AcpConnection` + `JobStore`), participates in
// the per-mind activation lifecycle, and returns an array of canvas-shape
// tools from `getToolsForMind`.
//
// Lifecycle invariants:
//   * The connection is started either lazily on first `activateMind` OR
//     eagerly via `prewarm()`. The composition root is expected to call
//     `prewarm()` at app boot when the feature flag is on, so the first
//     mind load sees the cli_* tools immediately. Without prewarm,
//     `MindManager.doLoadMind` calls `getSessionTools` BEFORE
//     `activateProviders`, so the first mind in a fresh process boots
//     its session without the cli_* tools.
//   * A single connection is reused across every active mind.
//   * The connection stops when the last activated mind is released.
//   * activate/release operations are serialized so concurrent activates
//     don't race the connection start.
//   * `activateMind` and `prewarm` swallow connection-start failures so a
//     missing/unspawnable CLI does NOT take down the entire mind-loading
//     pipeline. The service stays in a valid degraded state where
//     `getToolsForMind` returns []; the next activate retries the start.
//
// Trust boundary:
//   * Each mind sees a `MindScopedJobs` adapter — its job_ids are namespaced
//     `${mindId}:${realJobId}` and any cli_status/respond/approve/cancel
//     against another mind's job_id is rejected with the same UnknownJob
//     error a non-existent id would produce. cli_list returns only this
//     mind's jobs. See `MindScopedJobs.ts` for the rationale.
//   * Releasing a mind cancels all of its still-running delegated jobs so
//     work doesn't outlive the mind that owns it.

import {
  AcpConnection,
  JobStore,
  createAcpTools,
  type AcpTool,
} from 'chamber-copilot';
import type { ChamberToolProvider } from '../chamberTools';
import { Logger } from '../logger';
import type { Tool } from '../mind/types';
import { MindScopedJobs } from './MindScopedJobs';
import type {
  AcpConnectionFactory,
  AcpToolFactory,
  ChamberCopilotServiceOptions,
  JobStoreFactory,
} from './types';

const log = Logger.create('chamberCopilot');

const defaultJobStoreFactory: JobStoreFactory = (connection) =>
  new JobStore({ connection });

const defaultToolFactory: AcpToolFactory = (deps) => createAcpTools(deps);

export class ChamberCopilotService implements ChamberToolProvider {
  private readonly connectionFactory: AcpConnectionFactory;
  private readonly jobStoreFactory: JobStoreFactory;
  private readonly toolFactory: AcpToolFactory;
  private readonly activeMinds = new Set<string>();
  private readonly scopedStores = new Map<string, MindScopedJobs>();
  private readonly toolsByMind = new Map<string, AcpTool[]>();
  private connection: AcpConnection | null = null;
  private store: JobStore | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(options: ChamberCopilotServiceOptions) {
    this.connectionFactory = options.connectionFactory;
    this.jobStoreFactory = options.jobStoreFactory ?? defaultJobStoreFactory;
    this.toolFactory = options.toolFactory ?? defaultToolFactory;
  }

  getToolsForMind(mindId: string, _mindPath: string): Tool[] {
    void _mindPath;
    if (!this.store) return [];
    const cached = this.toolsByMind.get(mindId);
    if (cached) return cached as unknown as Tool[];

    const scoped = this.getOrCreateScopedStore(mindId);
    const tools = this.toolFactory({ store: scoped as unknown as JobStore });
    this.toolsByMind.set(mindId, tools);
    return tools as unknown as Tool[];
  }

  async activateMind(mindId: string, _mindPath: string): Promise<void> {
    void _mindPath;
    try {
      await this.ensureStarted();
    } catch (error) {
      // Degrade gracefully: a missing/unspawnable copilot CLI must NOT
      // take down the mind-loading pipeline. The mind still loads with
      // its other tool providers; cli_* tools just aren't available
      // until the next activate succeeds.
      log.error(
        `chamber-copilot activateMind failed for mind=${mindId}; cli_* tools will be unavailable until next activate succeeds`,
        error,
      );
      return;
    }
    this.activeMinds.add(mindId);
    // Eagerly create the per-mind scoped store so that a getToolsForMind
    // call before activation returns [], and after activation always
    // returns this mind's own scoped surface.
    this.getOrCreateScopedStore(mindId);
  }

  // Eagerly start the AcpConnection so the cli_* tools are available to
  // the very first mind load. Without this, MindManager.doLoadMind calls
  // getSessionTools BEFORE activateProviders, so getToolsForMind returns
  // [] (because this.store is null) and the first mind boots its session
  // without the cli_* tools.
  //
  // Safe to call multiple times. Failures are logged and swallowed; the
  // service stays in a valid degraded state where getToolsForMind
  // returns []. The composition root is expected to call this once
  // during app boot when chamberCopilotEnabled === true.
  async prewarm(): Promise<void> {
    try {
      await this.ensureStarted();
    } catch (error) {
      log.error(
        'chamber-copilot prewarm failed; cli_* tools unavailable until next activate succeeds',
        error,
      );
    }
  }

  async releaseMind(mindId: string): Promise<void> {
    if (!this.activeMinds.delete(mindId)) return;
    const scoped = this.scopedStores.get(mindId);
    this.scopedStores.delete(mindId);
    this.toolsByMind.delete(mindId);
    if (scoped) {
      await scoped.releaseAll();
    }
    if (this.activeMinds.size === 0) {
      await this.shutdown();
    }
  }

  private getOrCreateScopedStore(mindId: string): MindScopedJobs {
    let scoped = this.scopedStores.get(mindId);
    if (!scoped) {
      // INVARIANT: callers (getToolsForMind / activateMind) verify
      // `this.store` is non-null before reaching here. getToolsForMind
      // short-circuits when `this.store` is null; activateMind only
      // calls this after a successful `ensureStarted()`.
      scoped = new MindScopedJobs(this.store!, mindId);
      this.scopedStores.set(mindId, scoped);
    }
    return scoped;
  }

  private async ensureStarted(): Promise<void> {
    if (this.connection && this.store) return;
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    const connection = this.connectionFactory();
    try {
      await connection.start();
    } catch (error) {
      log.error('Failed to start chamber-copilot AcpConnection', error);
      throw error;
    }
    this.connection = connection;
    this.store = this.jobStoreFactory(connection);
    log.info('chamber-copilot AcpConnection started');
  }

  private async shutdown(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.store = null;
    this.scopedStores.clear();
    this.toolsByMind.clear();
    if (!connection) return;
    try {
      await connection.stop();
      log.info('chamber-copilot AcpConnection stopped');
    } catch (error) {
      log.warn('chamber-copilot AcpConnection stop failed', error);
    }
  }
}
