// Ambient module declaration for the published `chamber-copilot` package.
//
// chamber-copilot ships pure ESM JavaScript with no `.d.ts` files. This shim
// declares only the surface ChamberCopilotService consumes from the package
// — keeping the type contract narrow and explicit. If chamber-copilot adds
// its own typings in a future release, replace this file by deleting it.
//
// Source of truth for shapes: chamber-copilot v0.4.x
//   - lib/acp-connection.mjs (AcpConnection, defaultAcpConnectionFactory)
//   - lib/job-store.mjs      (JobStore, JOB_STATUS, error classes)
//   - tools/acp-tools.mjs    (createAcpTools)

declare module 'chamber-copilot' {
  export const ACP_PROTOCOL_VERSION: number;
  export const DEFAULT_ACP_CLI_COMMAND: string;
  export const DEFAULT_ACP_ARGS: readonly string[];

  export class AcpConnectionAlreadyStartedError extends Error {
    readonly name: 'AcpConnectionAlreadyStartedError';
  }

  export class AcpConnectionNotStartedError extends Error {
    readonly name: 'AcpConnectionNotStartedError';
  }

  /** Permission-request shape passed to AcpConnection.setPermissionHandler. */
  export interface AcpPermissionRequest {
    readonly sessionId: string;
    readonly toolCall: unknown;
    readonly options: ReadonlyArray<unknown>;
  }

  export type AcpPermissionOptionId =
    | 'allow_once'
    | 'allow_always'
    | 'reject_once'
    | 'reject_always';

  export interface AcpPermissionResponse {
    readonly outcome: {
      readonly outcome: 'selected';
      readonly optionId: AcpPermissionOptionId;
    };
  }

  export type AcpPermissionHandlerResult =
    | AcpPermissionResponse
    | AcpPermissionOptionId
    | unknown;

  export type AcpSessionUpdateHandler = (params: {
    readonly sessionId: string;
    readonly update: unknown;
  }) => void;

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
    newSession(params: {
      readonly cwd: string;
      readonly mcpServers?: ReadonlyArray<unknown>;
    }): Promise<{ readonly sessionId: string }>;
    prompt(
      sessionId: string,
      prompt: string | ReadonlyArray<unknown>,
    ): Promise<{ readonly stopReason?: string } | undefined>;
    cancel(sessionId: string): Promise<void>;
    onSessionUpdate(
      sessionId: string,
      handler: AcpSessionUpdateHandler,
    ): () => void;
    onSessionUpdate(handler: AcpSessionUpdateHandler): () => void;
    setPermissionHandler(
      handler:
        | ((req: AcpPermissionRequest) => AcpPermissionHandlerResult | Promise<AcpPermissionHandlerResult>)
        | null,
    ): void;
    setRequestHandler(
      method: string,
      handler: (params: unknown) => unknown | Promise<unknown>,
    ): void;
  }

  export const JOB_STATUS: {
    readonly RUNNING: 'running';
    readonly AWAITING_APPROVAL: 'awaiting_approval';
    readonly AWAITING_USER_INPUT: 'awaiting_user_input';
    readonly IDLE: 'idle';
    readonly ERRORED: 'errored';
    readonly CANCELLED: 'cancelled';
  };

  export const DEFAULT_MAX_EVENT_LOG_ENTRIES: number;

  export class UnknownJobError extends Error {
    readonly name: 'UnknownJobError';
    readonly jobId: string;
  }

  export class JobNotIdleError extends Error {
    readonly name: 'JobNotIdleError';
    readonly jobId: string;
    readonly status: string;
  }

  export class NoPendingApprovalError extends Error {
    readonly name: 'NoPendingApprovalError';
    readonly jobId: string;
    readonly approvalId: string;
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

  // Shared utilities
  export const MAX_SYSTEM_PROMPT_BYTES: number;
  export const ALLOW_ANY_CWD_ENV: string;
  export function validateCwd(cwd: string): string | null;
}
