import type { AcpConnection, JobStore, AcpTool } from 'chamber-copilot';

/**
 * Port for constructing the underlying ACP connection.
 *
 * Tests inject a fake that returns an in-memory connection without spawning
 * the real `copilot --acp` child. Production wiring uses
 * `defaultAcpConnectionFactory` from `chamber-copilot`.
 */
export type AcpConnectionFactory = () => AcpConnection;

/**
 * Port for constructing the JobStore over a given connection.
 *
 * Defaults to chamber-copilot's `JobStore` constructor; tests substitute a
 * fake to assert wiring without depending on the real implementation's
 * Promise scheduling.
 */
export type JobStoreFactory = (connection: AcpConnection) => JobStore;

/** Port for the canvas-shape tool factory. */
export type AcpToolFactory = (deps: { readonly store: JobStore }) => AcpTool[];

export interface ChamberCopilotServiceOptions {
  readonly connectionFactory: AcpConnectionFactory;
  readonly jobStoreFactory?: JobStoreFactory;
  readonly toolFactory?: AcpToolFactory;
}
