// Ambient module declarations for the published `chamber-copilot` package,
// which ships pure ESM JavaScript with no `.d.ts` files.
//
// This shim mirrors the chamber-copilot v0.4.x public surface that Chamber's
// TypeScript code consumes directly:
//
//   - `apps/desktop/src/main.ts` — `defaultAcpConnectionFactory`, `AcpConnection`
//   - `packages/services/src/chamberCopilot/ChamberCopilotService.ts`
//     — `AcpConnection`, `JobStore`, `createAcpTools`, `AcpTool`
//   - `packages/services/src/chamberCopilot/MindScopedJobs.ts`
//     — `AcpPermissionOptionId`, `JobSnapshot`, `JobStore`
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

  export interface AcpFactoryOptions {
    readonly command?: string;
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

  export interface JobStoreOptions {
    readonly connection: AcpConnection;
    readonly idFactory?: () => string;
    readonly now?: () => number;
    readonly cwdValidator?: (cwd: string) => string | null | undefined;
    readonly maxEventLogEntries?: number;
  }

  export class JobStore {
    constructor(options: JobStoreOptions);
    delegate(params: {
      readonly cwd: string;
      readonly prompt: string;
    }): Promise<{ readonly jobId: string; readonly sessionId: string }>;
    respond(jobId: string, prompt: string): Promise<void>;
    approve(jobId: string, approvalId: string, optionId: AcpPermissionOptionId): Promise<void>;
    cancel(jobId: string): Promise<void>;
    status(jobId: string): JobSnapshot;
    list(filter?: { readonly status?: string; readonly cwd?: string }): JobSnapshot[];
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
