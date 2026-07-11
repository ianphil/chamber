// Chamber-owned process wrapper around the WTD topology-advisor runtime.
// Implements `WtdRuntimeClient` (packages/services/src/wtd/types.ts) so it can
// be handed to `WtdAdvisorService` as the production runtime, in place of
// `FakeWtdRuntimeClient` in tests/dev.
//
// Spawns the checked-in chamber-wtd-runtime/host.mjs script in its own Node
// process — a standalone bundled Node in packaged builds, the current Node
// (or Electron with ELECTRON_RUN_AS_NODE) in dev — so `onnxruntime-node`
// never loads into the Electron main process. All communication happens over
// Node's child-process IPC channel (`process.send` / `process.on('message')`
// on the host side); stdout/stderr are captured only as bounded diagnostics.
//
// This class never logs the raw `query` or `draftDag` contents of a retrieve
// request — only bounded metadata (k, mode, queryKind) belongs in logs or
// error messages.

import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Logger } from '../logger';
import type { SdkRuntimeLayout } from '../ports';
import { resolveWtdRuntime, type WtdRuntimePaths } from './runtimeResolution';
import type {
  WtdCompactDraftDag,
  WtdRetrievalMode,
  WtdRetrieveRequest,
  WtdRuntimeCandidate,
  WtdRuntimeClient,
  WtdRuntimeRetrieveResult,
} from './types';

const log = Logger.create('wtd-runtime-process');

export const DEFAULT_INIT_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_RETRIEVE_TIMEOUT_MS = 30 * 1000;
export const DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK = 2;
const OUTPUT_CAP_BYTES = 64 * 1024;

// Matches the bounds WtdAdvisorService already enforces before it ever calls
// `retrieve()`. Kept in sync deliberately: this validation is a defensive
// second layer, not a stricter one — it must never reject a request the tool
// layer already accepted.
const MAX_K = 5;
const MAX_QUERY_LENGTH = 4_000;
const MAX_DRAFT_TITLE_LENGTH = 512;
const MAX_DRAFT_STEPS = 64;
const MAX_DRAFT_STEP_LENGTH = 512;
const VALID_MODES = new Set<WtdRetrievalMode>(['auto', 'structural', 'metadata']);

export interface WtdRuntimeProcessOptions {
  /** Explicit cache directory the host downloads/loads the pinned bundle into. */
  readonly cacheDir: string;
  readonly modelRepo?: string;
  readonly modelRevision?: string;
  /** Runtime layout used by the default resolver. Ignored if resolveRuntime is set. */
  readonly layout?: SdkRuntimeLayout;
  /** Full override of runtime path resolution — the primary test seam. */
  readonly resolveRuntime?: () => WtdRuntimePaths;
  /** Injectable in place of node:child_process fork — the other test seam. */
  readonly forkFn?: typeof fork;
  readonly initTimeoutMs?: number;
  readonly retrieveTimeoutMs?: number;
  readonly maxCrashesBeforeCircuitBreak?: number;
}

interface PendingRequest {
  readonly resolve: (message: HostMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type HostRetrieveResult = {
  readonly queryKind: 'text' | 'draftDag';
  readonly querySummary: string;
  readonly candidates: WtdRuntimeCandidate[];
  readonly fallback?: WtdRuntimeRetrieveResult['fallback'];
};

type HostMessage =
  | { type: 'initialized'; requestId: string; cacheHit: boolean; packageVersion: string; revision: string }
  | { type: 'retrieved'; requestId: string; result: HostRetrieveResult }
  | { type: 'error'; requestId: string; message: string };

type ProcessState = 'idle' | 'starting' | 'ready' | 'shutdown';

/**
 * Chamber-owned control process for the WTD topology advisor. Spawns and
 * supervises the chamber-wtd-runtime host, correlates IPC requests, and
 * enforces the first-slice retrieve contract (query and/or compact draft
 * DAG, k <= 5, mode in auto/structural/metadata).
 */
export class WtdRuntimeProcess implements WtdRuntimeClient {
  private readonly cacheDir: string;
  private readonly modelRepo?: string;
  private readonly modelRevision?: string;
  private readonly resolveRuntime: () => WtdRuntimePaths;
  private readonly forkFn: typeof fork;
  private readonly initTimeoutMs: number;
  private readonly retrieveTimeoutMs: number;
  private readonly maxCrashesBeforeCircuitBreak: number;

  private child: ChildProcess | null = null;
  private state: ProcessState = 'idle';
  private readonly pending = new Map<string, PendingRequest>();
  private crashTimestamps: number[] = [];
  private circuitOpen = false;
  private initPromise: Promise<void> | null = null;
  private stderrTail = '';
  private stdoutTail = '';
  private packageVersion = '';
  private revision = '';
  private cacheHit = false;

  constructor(options: WtdRuntimeProcessOptions) {
    this.cacheDir = options.cacheDir;
    this.modelRepo = options.modelRepo;
    this.modelRevision = options.modelRevision;
    this.resolveRuntime = options.resolveRuntime
      ?? (() => resolveWtdRuntime(options.layout));
    this.forkFn = options.forkFn ?? fork;
    this.initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.retrieveTimeoutMs = options.retrieveTimeoutMs ?? DEFAULT_RETRIEVE_TIMEOUT_MS;
    this.maxCrashesBeforeCircuitBreak = options.maxCrashesBeforeCircuitBreak ?? DEFAULT_MAX_CRASHES_BEFORE_CIRCUIT_BREAK;
  }

  /** Spawns the host (if needed) and waits for it to load the pinned bundle. */
  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    this.assertCircuitClosed();
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    // `this.initPromise` must be the exact promise every caller awaits (not a
    // `.finally()`-derived copy). A derived promise nobody else references
    // would still reject on failure, and Node flags that as an unhandled
    // rejection even though the original `promise` below is properly awaited.
    const promise = this.doInitialize();
    this.initPromise = promise;
    try {
      await promise;
    } finally {
      if (this.initPromise === promise) {
        this.initPromise = null;
      }
    }
  }

  /**
   * Retrieves topology candidates for a query and/or compact draft DAG.
   * Retrieval is idempotent (read-only), so exactly one transparent retry is
   * attempted if the first attempt fails for any reason (host crash, IPC
   * timeout, etc).
   */
  async retrieve(request: WtdRetrieveRequest): Promise<WtdRuntimeRetrieveResult> {
    const validated = validateRetrieveInput(request);
    await this.initialize();
    try {
      return await this.sendRetrieve(validated);
    } catch (firstError) {
      log.warn(`WTD retrieve failed, retrying once: ${getErrorMessage(firstError)}`);
      await this.initialize();
      return await this.sendRetrieve(validated);
    }
  }

  /** Shuts the host down gracefully, killing it if it does not exit promptly. */
  async stop(): Promise<void> {
    this.state = 'shutdown';
    this.clearCircuitBreaker();
    const child = this.child;
    if (!child) {
      this.rejectAllPending(new Error('WTD runtime process shut down'));
      return;
    }

    try {
      child.send?.({ type: 'shutdown' });
    } catch {
      // The channel may already be gone — fall through to a hard kill below.
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.killChild();
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.child = null;
    this.rejectAllPending(new Error('WTD runtime process shut down'));
  }

  private async doInitialize(): Promise<void> {
    this.state = 'starting';
    let paths: WtdRuntimePaths;
    try {
      paths = this.resolveRuntime();
    } catch (error) {
      this.state = 'idle';
      throw error;
    }

    const child = this.forkFn(paths.hostPath, [paths.wtdEntry], {
      execPath: paths.nodeBinary,
      // Bundled Node in packaged builds ignores this; Electron in dev honors
      // it so the forked process behaves as plain Node instead of Electron.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      silent: true,
    });
    this.attachChild(child);

    const requestId = randomUUID();
    try {
      const message = await this.sendAndWait(child, {
        type: 'initialize',
        requestId,
        cacheDir: this.cacheDir,
        modelRepo: this.modelRepo,
        modelRevision: this.modelRevision,
      }, this.initTimeoutMs);
      if (message.type !== 'initialized') {
        throw new Error('WTD runtime returned an unexpected response to initialize');
      }
      this.packageVersion = message.packageVersion;
      this.revision = message.revision;
      this.cacheHit = message.cacheHit;
      this.state = 'ready';
      log.info(`WTD runtime initialized (revision=${this.revision}, cacheHit=${this.cacheHit})`);
    } catch (error) {
      this.state = 'idle';
      this.killChild();
      throw error;
    }
  }

  private async sendRetrieve(request: ValidatedRetrieveInput): Promise<WtdRuntimeRetrieveResult> {
    if (this.state !== 'ready' || !this.child) {
      throw new Error('WTD runtime process is not ready');
    }
    const requestId = randomUUID();
    const message = await this.sendAndWait(this.child, {
      type: 'retrieve',
      requestId,
      ...(request.query !== undefined ? { query: request.query } : {}),
      ...(request.draftDag !== undefined ? { draftDag: request.draftDag } : {}),
      k: request.k,
      mode: request.mode,
    }, this.retrieveTimeoutMs);
    if (message.type !== 'retrieved') {
      throw new Error('WTD runtime returned an unexpected response to retrieve');
    }
    return {
      packageVersion: this.packageVersion,
      revision: this.revision,
      cacheHit: this.cacheHit,
      ...message.result,
    };
  }

  private attachChild(child: ChildProcess): void {
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutTail = capTail(this.stdoutTail, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = capTail(this.stderrTail, chunk);
    });
    child.on('message', (message) => this.handleMessage(message));
    child.on('exit', (code) => this.handleExit(code));
    child.on('error', (error) => this.handleSpawnError(error));
  }

  private handleMessage(message: unknown): void {
    if (!isHostMessage(message)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === 'error') {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message);
  }

  private handleExit(code: number | null): void {
    this.child = null;
    const wasShuttingDown = this.state === 'shutdown';
    if (!wasShuttingDown) {
      this.state = 'idle';
      this.recordCrash();
    }
    this.rejectAllPending(new Error(
      `WTD runtime process exited unexpectedly (code ${String(code)}).`
      + (this.stderrTail ? ` stderr: ${this.stderrTail}` : ''),
    ));
  }

  private handleSpawnError(error: Error): void {
    this.rejectAllPending(new Error(`WTD runtime process error: ${error.message}`, { cause: error }));
  }

  private recordCrash(): void {
    this.crashTimestamps.push(Date.now());
    if (this.crashTimestamps.length >= this.maxCrashesBeforeCircuitBreak) {
      this.circuitOpen = true;
      log.warn(
        `WTD runtime crashed ${this.crashTimestamps.length} times; disabling it for the rest of the app session`,
      );
    }
  }

  private clearCircuitBreaker(): void {
    this.crashTimestamps = [];
    this.circuitOpen = false;
  }

  private assertCircuitClosed(): void {
    if (this.circuitOpen) {
      throw new Error('WTD runtime circuit breaker is open after repeated crashes for the rest of this app session');
    }
  }

  private sendAndWait(
    child: ChildProcess,
    message: Record<string, unknown> & { requestId: string; type: string },
    timeoutMs: number,
  ): Promise<HostMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.requestId);
        reject(new Error(`WTD runtime timed out waiting for "${message.type}" after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(message.requestId, { resolve, reject, timer });
      try {
        child.send(message);
      } catch (error) {
        this.pending.delete(message.requestId);
        clearTimeout(timer);
        reject(new Error(`Failed to send "${message.type}" to WTD runtime: ${getErrorMessage(error)}`, { cause: error }));
      }
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

interface ValidatedRetrieveInput {
  readonly query?: string;
  readonly draftDag?: WtdCompactDraftDag;
  readonly k: number;
  readonly mode: WtdRetrievalMode;
}

function validateRetrieveInput(request: WtdRetrieveRequest): ValidatedRetrieveInput {
  const mode = request.mode ?? 'auto';
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid WTD retrieve mode: ${String(mode)}. Expected one of auto, structural, metadata.`);
  }

  const k = request.k ?? MAX_K;
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw new Error(`Invalid WTD retrieve k: ${String(k)}. Must be an integer between 1 and ${MAX_K}.`);
  }

  const hasQuery = request.query !== undefined;
  if (hasQuery) {
    if (typeof request.query !== 'string' || request.query.trim().length === 0) {
      throw new Error('WTD retrieve query must be a non-empty string.');
    }
    if (request.query.length > MAX_QUERY_LENGTH) {
      throw new Error(`WTD retrieve query exceeds the maximum length of ${MAX_QUERY_LENGTH} characters.`);
    }
  }

  const hasDraftDag = request.draftDag !== undefined;
  if (hasDraftDag) {
    validateCompactDraftDag(request.draftDag as WtdCompactDraftDag);
  }

  if (!hasQuery && !hasDraftDag) {
    throw new Error('WTD retrieve requires a query and/or a draftDag.');
  }

  return {
    ...(hasQuery ? { query: request.query } : {}),
    ...(hasDraftDag ? { draftDag: request.draftDag } : {}),
    k,
    mode,
  };
}

function validateCompactDraftDag(draftDag: WtdCompactDraftDag): void {
  if (draftDag.title !== undefined) {
    if (typeof draftDag.title !== 'string' || draftDag.title.length === 0) {
      throw new Error('WTD retrieve draftDag.title must be a non-empty string when provided.');
    }
    if (draftDag.title.length > MAX_DRAFT_TITLE_LENGTH) {
      throw new Error(`WTD retrieve draftDag.title exceeds the maximum length of ${MAX_DRAFT_TITLE_LENGTH} characters.`);
    }
  }
  if (!Array.isArray(draftDag.steps) || draftDag.steps.length === 0) {
    throw new Error('WTD retrieve draftDag.steps must be a non-empty array of strings.');
  }
  if (draftDag.steps.length > MAX_DRAFT_STEPS) {
    throw new Error(`WTD retrieve draftDag.steps exceeds the maximum of ${MAX_DRAFT_STEPS} steps.`);
  }
  for (const step of draftDag.steps) {
    if (typeof step !== 'string' || step.trim().length === 0) {
      throw new Error('WTD retrieve draftDag.steps must contain only non-empty strings.');
    }
    if (step.length > MAX_DRAFT_STEP_LENGTH) {
      throw new Error(`WTD retrieve draftDag.steps entries exceed the maximum length of ${MAX_DRAFT_STEP_LENGTH} characters.`);
    }
  }
}

function isHostMessage(message: unknown): message is HostMessage {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.requestId !== 'string') return false;
  return candidate.type === 'initialized' || candidate.type === 'retrieved' || candidate.type === 'error';
}

function capTail(existing: string, chunk: Buffer): string {
  const combined = existing + chunk.toString('utf8');
  return combined.length > OUTPUT_CAP_BYTES ? combined.slice(combined.length - OUTPUT_CAP_BYTES) : combined;
}
