// Ambient module declarations for the published `chamber-copilot` package,
// which ships pure ESM JavaScript with `"types": null` in package.json.
//
// This shim mirrors the chamber-copilot v0.5.11 public surface that Chamber's
// TypeScript code consumes directly:
//
//   - `apps/desktop/src/main.ts` — `defaultAcpConnectionFactory`,
//     `AcpConnection`, `YOLO_ACP_ARGS`
//   - `packages/services/src/chamberCopilot/ChamberCopilotService.ts`
//     — `AcpConnection`, `JobStore`, `createAcpTools`, `AcpTool`,
//       `ConnectionsByMode`
//   - `packages/services/src/chamberCopilot/MindScopedJobs.ts`
//     — `AcpPermissionOptionId`, `JobSnapshot`, `JobStore`,
//       `PermissionMode`, `JobListFilter`
//   - `packages/services/src/chamberCopilot/types.ts`
//     — `AcpConnection`, `JobStore`, `AcpTool`
//   - `packages/services/src/chamberCopilot/*.test.ts`
//     — `AcpConnection`, `AcpTool`, `JobSnapshot`, `JobStore`
//
// Anything not listed above is intentionally NOT declared here. If this
// package ships its own `.d.ts` in a future release, delete this file.

declare module 'chamber-copilot' {
  export type AcpPermissionOptionId =
    | 'allow_once'
    | 'allow_always'
    | 'reject_once'
    | 'reject_always';

  /**
   * Per-job permission posture (chamber-copilot >= 0.5.11, issue #37).
   *
   * - `'safe'` — default. Job is bound to the safe AcpConnection (the
   *   approval-gated child worker). Tool/path/url permission requests
   *   surface through `pendingApproval` and require `cli_approve`.
   * - `'yolo'` — opt-in. Job is bound to the yolo AcpConnection (the
   *   child worker started with `--yolo`, equivalent to
   *   `--allow-all-tools --allow-all-paths --allow-all-urls`). All
   *   permissions are pre-approved with no approval gate.
   *
   * The mode is selected per `delegate()` call and is the property of
   * the job for its entire lifetime.
   */
  export type PermissionMode = 'safe' | 'yolo';

  export const PERMISSION_MODES: ReadonlySet<PermissionMode>;
  export const DEFAULT_PERMISSION_MODE: 'safe';

  /**
   * Frozen args list for a yolo child worker. Hosts that wire a per-mode
   * connection pool import this and pass it as `args` to
   * `defaultAcpConnectionFactory` for the yolo connection.
   */
  export const YOLO_ACP_ARGS: ReadonlyArray<string>;

  /**
   * Thrown by `JobStore.delegate` when a caller requests a `permissionMode`
   * that the JobStore was not constructed with (e.g. requesting `'yolo'`
   * when only `connectionsByMode.safe` was wired).
   */
  export class UnsupportedPermissionModeError extends Error {
    readonly name: 'UnsupportedPermissionModeError';
    readonly permissionMode: string;
    constructor(permissionMode: string, supported?: ReadonlyArray<string>);
  }

  export interface AcpFactoryOptions {
    // `command` is REQUIRED at runtime in chamber-copilot >= 0.5.x:
    // `defaultAcpConnectionFactory({})` throws TypeError if absent. The
    // earlier silent `"copilot"` PATH-lookup default was removed because
    // it was vulnerable to PATH-hijack and broke packaged installs.
    readonly command: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly spawn?: typeof import('node:child_process').spawn;
  }

  /**
   * Returns an async factory that, when invoked, spawns a `copilot --acp`
   * child process and yields the JSON-RPC connection plus a teardown.
   */
  export function defaultAcpConnectionFactory(
    options?: AcpFactoryOptions,
  ): () => Promise<{
    readonly connection: unknown;
    readonly teardown?: () => Promise<void>;
  }>;

  export interface AcpConnectionOptions {
    readonly connectionFactory: () => Promise<{
      readonly connection: unknown;
      readonly teardown?: () => Promise<void>;
    }>;
  }

  export class AcpConnection {
    constructor(options: AcpConnectionOptions);
    readonly isStarted: boolean;
    readonly protocolVersion: number | null;
    start(): Promise<unknown>;
    stop(): Promise<void>;
  }

  export interface JobSnapshot {
    readonly jobId: string;
    readonly cwd: string;
    readonly sessionId: string;
    readonly status: string;
    /** Permission mode the job was delegated under. Defaults to `'safe'`. */
    readonly permissionMode: PermissionMode;
    readonly eventLog: ReadonlyArray<{ readonly at: number; readonly update: unknown }>;
    readonly pendingApproval: null | {
      readonly approvalId: string;
      readonly toolCall: unknown;
      readonly options: ReadonlyArray<unknown>;
    };
    readonly createdAt: number;
    readonly lastUpdateAt: number;
    readonly lastStopReason: string | null;
  }

  /**
   * Per-mode AcpConnection registry. `safe` is required; `yolo` is
   * optional. A JobStore constructed without a `yolo` connection rejects
   * `delegate({ permissionMode: 'yolo' })` with
   * `UnsupportedPermissionModeError`.
   */
  export interface ConnectionsByMode {
    readonly safe: AcpConnection;
    readonly yolo?: AcpConnection;
  }

  export interface JobStoreOptions {
    /**
     * Back-compat shorthand for `{ connectionsByMode: { safe: connection } }`.
     * If both `connection` and `connectionsByMode.safe` are supplied,
     * `connectionsByMode` wins (no silent shadowing).
     */
    readonly connection?: AcpConnection;
    readonly connectionsByMode?: ConnectionsByMode;
    readonly idFactory?: () => string;
    readonly now?: () => number;
    readonly cwdValidator?: (cwd: string) => string | null | undefined;
    readonly maxEventLogEntries?: number;
  }

  export interface DelegateParams {
    readonly cwd: string;
    readonly prompt: string;
    /** Defaults to `DEFAULT_PERMISSION_MODE` (`'safe'`). */
    readonly permissionMode?: PermissionMode;
  }

  export interface JobListFilter {
    readonly status?: string;
    readonly cwd?: string;
    readonly permissionMode?: PermissionMode;
  }

  export class JobStore {
    constructor(options: JobStoreOptions);
    delegate(params: DelegateParams): Promise<{ readonly jobId: string; readonly sessionId: string }>;
    respond(jobId: string, prompt: string): Promise<void>;
    approve(jobId: string, approvalId: string, optionId: AcpPermissionOptionId): Promise<void>;
    cancel(jobId: string): Promise<void>;
    status(jobId: string): JobSnapshot;
    list(filter?: JobListFilter): JobSnapshot[];
  }

  /** Canvas-shape tool object. */
  export interface AcpTool {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: 'object';
      readonly properties: Record<string, unknown>;
      readonly required?: ReadonlyArray<string>;
    };
    readonly handler: (args: Record<string, unknown> | undefined) => Promise<string>;
  }

  export function createAcpTools(deps: { readonly store: JobStore }): AcpTool[];
}
