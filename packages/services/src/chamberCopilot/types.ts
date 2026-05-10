import type { AcpConnection, JobStore, AcpTool, PermissionMode } from 'chamber-copilot';

/**
 * Port for constructing an underlying ACP connection.
 *
 * Tests inject a fake that returns an in-memory connection without spawning
 * the real `copilot --acp` child. Production wiring uses
 * `defaultAcpConnectionFactory` from `chamber-copilot`.
 */
export type AcpConnectionFactory = () => AcpConnection;

/**
 * Per-mode connection registry. `safe` is required; `yolo` is optional.
 *
 * The `safe` connection is the historic, approval-gated ACP child. The
 * `yolo` connection (when wired) spawns a `copilot --acp --yolo` worker
 * which pre-approves every tool, path, and URL — so any job delegated
 * with `permission_mode: 'yolo'` runs without an approval gate. Wire
 * yolo only when the host explicitly intends to grant unrestricted
 * permissions to delegated workers; downstream agents must opt in
 * per-call via `cli_delegate({ permission_mode: 'yolo' })`.
 *
 * Without a `yolo` factory wired, `cli_delegate({ permission_mode: 'yolo' })`
 * surfaces `UnsupportedPermissionModeError` from chamber-copilot — which
 * is the correct fail-closed behavior.
 */
export interface ChamberCopilotConnectionFactories {
  readonly safe: AcpConnectionFactory;
  readonly yolo?: AcpConnectionFactory;
}

/**
 * Port for constructing the JobStore over the per-mode connections.
 *
 * Defaults to chamber-copilot's `JobStore` constructor; tests substitute a
 * fake to assert wiring without depending on the real implementation's
 * Promise scheduling.
 */
export type JobStoreFactory = (
  connections: { readonly safe: AcpConnection; readonly yolo?: AcpConnection },
) => JobStore;

/** Port for the canvas-shape tool factory. */
export type AcpToolFactory = (deps: { readonly store: JobStore }) => AcpTool[];

/**
 * Either supply a single `connectionFactory` (back-compat shorthand for
 * `{ connectionsByMode: { safe: connectionFactory } }`), or supply
 * `connectionsByMode` explicitly. Supplying neither throws at
 * construction; supplying both is also rejected (avoid silent shadowing).
 */
export interface ChamberCopilotServiceOptions {
  readonly connectionFactory?: AcpConnectionFactory;
  readonly connectionsByMode?: ChamberCopilotConnectionFactories;
  readonly jobStoreFactory?: JobStoreFactory;
  readonly toolFactory?: AcpToolFactory;
}

/** Re-exported for callers that want to type their `cli_delegate` wrappers. */
export type { PermissionMode };
