// ChamberCopilotService — exposes chamber-copilot's `cli_*` ACP tool surface
// to chamber minds via the ChamberToolProvider seam.
//
// Pattern mirrors CanvasService: the service owns its underlying
// infrastructure (one shared `AcpConnection` + `JobStore`), participates in
// the per-mind activation lifecycle, and returns an array of canvas-shape
// tools from `getToolsForMind`.
//
// Lifecycle invariants:
//   * The connection is **lazy**: not started until the first mind activates.
//   * A single connection is reused across every active mind.
//   * The connection stops when the last activated mind is released, so
//     packaging/runtime cost is zero when the feature is enabled but no
//     mind is currently using it.
//   * activate/release operations are serialized so concurrent activates
//     don't race the connection start.

import {
  AcpConnection,
  JobStore,
  createAcpTools,
  type AcpTool,
} from 'chamber-copilot';
import type { ChamberToolProvider } from '../chamberTools';
import { Logger } from '../logger';
import type { Tool } from '../mind/types';
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
  private connection: AcpConnection | null = null;
  private store: JobStore | null = null;
  private tools: AcpTool[] | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(options: ChamberCopilotServiceOptions) {
    this.connectionFactory = options.connectionFactory;
    this.jobStoreFactory = options.jobStoreFactory ?? defaultJobStoreFactory;
    this.toolFactory = options.toolFactory ?? defaultToolFactory;
  }

  getToolsForMind(_mindId: string, _mindPath: string): Tool[] {
    void _mindId;
    void _mindPath;
    if (!this.store) return [];
    if (!this.tools) {
      this.tools = this.toolFactory({ store: this.store });
    }
    return this.tools as unknown as Tool[];
  }

  async activateMind(mindId: string, _mindPath: string): Promise<void> {
    void _mindPath;
    await this.ensureStarted();
    this.activeMinds.add(mindId);
  }

  async releaseMind(mindId: string): Promise<void> {
    if (!this.activeMinds.delete(mindId)) return;
    if (this.activeMinds.size === 0) {
      await this.shutdown();
    }
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
    this.tools = null;
    log.info('chamber-copilot AcpConnection started');
  }

  private async shutdown(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.store = null;
    this.tools = null;
    if (!connection) return;
    try {
      await connection.stop();
      log.info('chamber-copilot AcpConnection stopped');
    } catch (error) {
      log.warn('chamber-copilot AcpConnection stop failed', error);
    }
  }
}
