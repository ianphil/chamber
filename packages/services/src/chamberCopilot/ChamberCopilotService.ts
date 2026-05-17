// ChamberCopilotService — exposes chamber-copilot's `cli_*` ACP tool surface
// to chamber minds via the ChamberToolProvider seam.
//
// Pattern mirrors CanvasService: the service owns its underlying
// infrastructure (one shared `AcpConnection` per permission mode plus a
// shared `JobStore`), participates in the per-mind activation lifecycle,
// and returns an array of canvas-shape tools from `getToolsForMind`.
//
// Lifecycle invariants:
//   * Connections are started either lazily on first `activateMind` OR
//     eagerly via `prewarm()`. The composition root is expected to call
//     `prewarm()` at app boot when the feature flag is on, so the first
//     mind load sees the cli_* tools immediately. Without prewarm,
//     `MindManager.doLoadMind` calls `getSessionTools` BEFORE
//     `activateProviders`, so the first mind in a fresh process boots
//     its session without the cli_* tools.
//   * The single shared JobStore is reused across every active mind.
//   * The connections stop when the last activated mind is released.
//   * activate/release operations are serialized so concurrent activates
//     don't race the connection start.
//   * `activateMind` and `prewarm` swallow connection-start failures so a
//     missing/unspawnable CLI does NOT take down the entire mind-loading
//     pipeline. The service stays in a valid degraded state where
//     `getToolsForMind` returns []; the next activate retries the start.
//   * The yolo connection (if wired) is best-effort: a yolo-start failure
//     does NOT block the safe connection from coming up. The service runs
//     in a degraded "safe-only" mode and any `cli_delegate({ permission_mode:
//     'yolo' })` surfaces `UnsupportedPermissionModeError` from
//     chamber-copilot — which is the correct fail-closed behavior.
//
// Trust boundary:
//   * Each mind sees a `MindScopedJobs` adapter — its job_ids are namespaced
//     `${mindId}:${realJobId}` and any cli_status/respond/approve/cancel
//     against another mind's job_id is rejected with the same UnknownJob
//     error a non-existent id would produce. cli_list returns only this
//     mind's jobs. See `MindScopedJobs.ts` for the rationale.
//   * Releasing a mind cancels all of its still-running delegated jobs so
//     work doesn't outlive the mind that owns it.
//   * Yolo posture: per-mind opt-in does NOT exist at this layer. Whether
//     a delegated job runs in yolo mode is selected per-call by the calling
//     mind via the `permission_mode` argument to `cli_delegate`. The
//     upstream tool description warns the model about the trade-off.

import type {
  AcpConnection,
  JobStore,
  AcpTool,
} from 'chamber-copilot';
import type { ChamberToolProvider } from '../chamberTools';
import { Logger } from '../logger';
import type { Tool } from '../mind/types';
import { MindScopedJobs } from './MindScopedJobs';
import type {
  AcpToolFactory,
  ChamberCopilotConnectionFactories,
  ChamberCopilotServiceOptions,
  JobStoreFactory,
} from './types';

const log = Logger.create('chamberCopilot');

interface StartedConnections {
  readonly safe: AcpConnection;
  readonly yolo?: AcpConnection;
}

export class ChamberCopilotService implements ChamberToolProvider {
  private readonly connectionFactories: ChamberCopilotConnectionFactories;
  private readonly jobStoreFactory: JobStoreFactory;
  private readonly toolFactory: AcpToolFactory;
  private readonly activeMinds = new Set<string>();
  private readonly scopedStores = new Map<string, MindScopedJobs>();
  private readonly toolsByMind = new Map<string, AcpTool[]>();
  private connections: StartedConnections | null = null;
  private store: JobStore | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(options: ChamberCopilotServiceOptions) {
    this.connectionFactories = resolveFactories(options);
    this.jobStoreFactory = options.jobStoreFactory;
    this.toolFactory = options.toolFactory;
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
  // during app boot when the channel-derived chamberCopilot feature flag is on.
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
    if (this.connections && this.store) return;
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
    // Safe MUST start successfully. A safe-start failure is fatal for the
    // service: without the safe connection chamber-copilot cannot serve
    // any delegated jobs (yolo alone is rejected at JobStore construction).
    const safe = this.connectionFactories.safe();
    try {
      await safe.start();
    } catch (error) {
      log.error('Failed to start chamber-copilot safe AcpConnection', error);
      throw error;
    }

    // Yolo is best-effort. If wiring it fails (CLI permission denied,
    // --yolo unsupported by an older bundled CLI, factory throws…) the
    // service continues in safe-only mode. cli_delegate with
    // permission_mode: 'yolo' will surface UnsupportedPermissionModeError
    // from chamber-copilot — which is the correct fail-closed behavior.
    let yolo: AcpConnection | undefined;
    if (this.connectionFactories.yolo) {
      try {
        const yoloCandidate = this.connectionFactories.yolo();
        await yoloCandidate.start();
        yolo = yoloCandidate;
      } catch (error) {
        log.error(
          'chamber-copilot yolo AcpConnection failed to start; running in safe-only mode',
          error,
        );
      }
    }

    this.connections = yolo ? { safe, yolo } : { safe };
    this.store = this.jobStoreFactory(this.connections);
    log.info(
      yolo
        ? 'chamber-copilot AcpConnections started (safe + yolo)'
        : 'chamber-copilot AcpConnection started (safe-only)',
    );
  }

  private async shutdown(): Promise<void> {
    const connections = this.connections;
    this.connections = null;
    this.store = null;
    this.scopedStores.clear();
    this.toolsByMind.clear();
    if (!connections) return;
    await this.stopOne(connections.safe, 'safe');
    if (connections.yolo) {
      await this.stopOne(connections.yolo, 'yolo');
    }
  }

  private async stopOne(connection: AcpConnection, label: 'safe' | 'yolo'): Promise<void> {
    try {
      await connection.stop();
      log.info(`chamber-copilot ${label} AcpConnection stopped`);
    } catch (error) {
      log.warn(`chamber-copilot ${label} AcpConnection stop failed`, error);
    }
  }
}

function resolveFactories(
  options: ChamberCopilotServiceOptions,
): ChamberCopilotConnectionFactories {
  const { connectionFactory, connectionsByMode } = options;
  if (connectionFactory && connectionsByMode) {
    throw new TypeError(
      'ChamberCopilotService: pass either `connectionFactory` (back-compat shorthand for `{ safe }`) or `connectionsByMode`, not both.',
    );
  }
  if (connectionsByMode) {
    if (typeof connectionsByMode.safe !== 'function') {
      throw new TypeError(
        'ChamberCopilotService: `connectionsByMode.safe` is required and must be a factory function.',
      );
    }
    if (
      connectionsByMode.yolo !== undefined
      && typeof connectionsByMode.yolo !== 'function'
    ) {
      throw new TypeError(
        'ChamberCopilotService: `connectionsByMode.yolo`, when supplied, must be a factory function.',
      );
    }
    return connectionsByMode;
  }
  if (connectionFactory) {
    if (typeof connectionFactory !== 'function') {
      throw new TypeError(
        'ChamberCopilotService: `connectionFactory` must be a factory function.',
      );
    }
    return { safe: connectionFactory };
  }
  throw new TypeError(
    'ChamberCopilotService: pass `connectionFactory` (back-compat) or `connectionsByMode`.',
  );
}
