// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserWindow } from 'electron';
import type { MindContext, AppConfig, MindRecord } from '../../../shared/types';
import type { InternalMindContext, CopilotClient, CopilotSession, Tool, UserInputHandler } from './types';
import { generateMindId } from './generateMindId';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
  private windowByMind = new Map<string, BrowserWindow>();
  private activeMindId: string | null = null;
  private restorePromise: Promise<void> | null = null;
  private reloading = false;
  private providers: ChamberToolProvider[] = [];

  constructor(
    private readonly clientFactory: CopilotClientFactory,
    private readonly identityLoader: IdentityLoader,
    private readonly configService: ConfigService,
    private readonly viewDiscovery: ViewDiscovery,
  ) {
    super();
  }

  setProviders(providers: ChamberToolProvider[]): void {
    this.providers = [...providers];
  }

  async loadMind(mindPath: string, mindId?: string): Promise<MindContext> {
    // Deduplicate — return existing mind
    const existingId = this.pathToId.get(mindPath);
    if (existingId && this.minds.has(existingId)) {
      const existing = this.minds.get(existingId);
      if (!existing) throw new Error(`Mind ${existingId} not found`);
      return this.toExternalContext(existing);
    }

    // Concurrent guard — return in-flight promise
    const inflight = this.loading.get(mindPath);
    if (inflight) return inflight;

    const promise = this.doLoadMind(mindPath, mindId);
    this.loading.set(mindPath, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(mindPath);
    }
  }

  private async doLoadMind(mindPath: string, mindId?: string): Promise<MindContext> {
    // Validate
    this.validateMindPath(mindPath);

    // Use provided ID or generate a new one
    const id = mindId ?? generateMindId(mindPath);

    // Load identity
    const identity = this.identityLoader.load(mindPath);
    if (!identity) {
      throw new Error(`Failed to load identity from ${mindPath}`);
    }

    // Create client
    const client = await this.clientFactory.createClient(mindPath);

    const sessionTools = this.getSessionTools(id, mindPath);

    // Create session
    const session = await this.createSessionForMind(client, mindPath, identity.systemMessage, sessionTools);

    const context: InternalMindContext = {
      mindId: id,
      mindPath,
      identity,
      status: 'ready',
      client,
      session,
    };

    this.minds.set(id, context);
    this.pathToId.set(mindPath, id);

    try {
      await Promise.all([
        this.activateProviders(id, mindPath),
        this.viewDiscovery.scan(mindPath),
      ]);
    } catch (err) {
      this.minds.delete(id);
      this.pathToId.delete(mindPath);
      await this.releaseProviders(id).catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
      throw err;
    }

    // Persist
    this.persistConfig();

    this.emit('mind:loaded', this.toExternalContext(context));
    return this.toExternalContext(context);
  }

  async unloadMind(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) return;

    await this.releaseProviders(mindId);

    // Destroy client
    await this.clientFactory.destroyClient(context.client);

    // Remove views/watchers
    this.viewDiscovery.removeMind(context.mindPath);

    // Remove from maps
    this.minds.delete(mindId);
    this.pathToId.delete(context.mindPath);

    // Update active mind if needed
    if (this.activeMindId === mindId) {
      const remaining = Array.from(this.minds.keys());
      this.activeMindId = remaining.length > 0 ? remaining[0] : null;
    }

    // Persist
    this.persistConfig();

    this.emit('mind:unloaded', mindId);
  }

  listMinds(): MindContext[] {
    return Array.from(this.minds.values()).map(m => this.toExternalContext(m));
  }

  getMind(mindId: string): Readonly<InternalMindContext> | undefined {
    return this.minds.get(mindId);
  }

  setActiveMind(mindId: string): void {
    if (this.minds.has(mindId)) {
      this.activeMindId = mindId;
    }
  }

  getActiveMindId(): string | null {
    return this.activeMindId;
  }

  // --- Window management ---

  attachWindow(mindId: string, win: BrowserWindow): void {
    if (!this.minds.has(mindId)) return;
    this.windowByMind.set(mindId, win);
    win.on('closed', () => this.detachWindow(mindId));
    this.emit('mind:windowed', mindId);
  }

  detachWindow(mindId: string): void {
    this.windowByMind.delete(mindId);
    this.emit('mind:unwindowed', mindId);
  }

  getWindow(mindId: string): BrowserWindow | null {
    return this.windowByMind.get(mindId) ?? null;
  }

  isWindowed(mindId: string): boolean {
    return this.windowByMind.has(mindId);
  }

  async recreateSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    context.session = await this.createSessionForMind(
      context.client, context.mindPath, context.identity.systemMessage, sessionTools,
    );
    return context.session;
  }

  awaitRestore(): Promise<void> {
    return this.restorePromise ?? Promise.resolve();
  }

  async restoreFromConfig(): Promise<void> {
    this.restorePromise = this.doRestore();
    return this.restorePromise;
  }

  async reloadAllMinds(): Promise<void> {
    await this.awaitRestore();

    const existingConfig = this.configService.load();
    const configSnapshot: AppConfig = {
      version: 2,
      minds: Array.from(this.minds.values()).map((mind) => ({
        id: mind.mindId,
        path: mind.mindPath,
      })),
      activeMindId: this.activeMindId,
      activeLogin: existingConfig.activeLogin,
      theme: existingConfig.theme,
    };

    this.reloading = true;
    try {
      const loadedMindIds = Array.from(this.minds.keys());
      for (const mindId of loadedMindIds) {
        await this.unloadMind(mindId);
      }
    } finally {
      this.reloading = false;
    }

    this.activeMindId = null;
    this.configService.save(configSnapshot);
    await this.restoreFromConfig();
  }

  private async doRestore(): Promise<void> {
    const config = this.configService.load();
    for (const record of config.minds) {
      try {
        await this.loadMind(record.path, record.id);
      } catch (err) {
        console.error(`[MindManager] Failed to restore mind at ${record.path}:`, err);
      }
    }

    if (config.activeMindId && this.minds.has(config.activeMindId)) {
      this.activeMindId = config.activeMindId;
    } else if (this.minds.size > 0) {
      this.activeMindId = Array.from(this.minds.keys())[0];
    }
  }

  async shutdown(): Promise<void> {
    // Save config BEFORE destroying anything — preserve mind list for next launch
    this.persistConfig();

    // Clean up resources without persisting (don't call unloadMind which clears config)
    for (const [, context] of this.minds) {
      await this.releaseProviders(context.mindId);
      await this.clientFactory.destroyClient(context.client);
      this.viewDiscovery.removeMind(context.mindPath);
    }
    this.minds.clear();
    this.pathToId.clear();
  }

  // --- Private helpers ---

  private validateMindPath(mindPath: string): void {
    const hasSoul = fs.existsSync(path.join(mindPath, 'SOUL.md'));
    const hasGithub = fs.existsSync(path.join(mindPath, '.github'));
    if (!hasSoul && !hasGithub) {
      throw new Error(`Invalid mind directory: ${mindPath} — must contain SOUL.md or .github/`);
    }
  }

  private toExternalContext(ctx: InternalMindContext): MindContext {
    return {
      mindId: ctx.mindId,
      mindPath: ctx.mindPath,
      identity: ctx.identity,
      status: ctx.status,
      error: ctx.error,
      windowed: this.windowByMind.has(ctx.mindId),
    };
  }

  private getSessionTools(mindId: string, mindPath: string): Tool[] {
    return this.providers.flatMap((provider) => provider.getToolsForMind(mindId, mindPath));
  }

  private async activateProviders(mindId: string, mindPath: string): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.activateMind?.(mindId, mindPath)));
  }

  private async releaseProviders(mindId: string): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.releaseMind?.(mindId)));
  }

  async createTaskSession(
    mindId: string,
    taskId: string,
    onUserInputRequest?: UserInputHandler,
  ): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind(
      context.client,
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      onUserInputRequest,
    );
  }

  async createChatroomSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind(
      context.client,
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
    );
  }

  private async createSessionForMind(
    client: CopilotClient,
    mindPath: string,
    systemMessage: string,
    tools: Tool[],
    onUserInputRequest?: UserInputHandler,
  ): Promise<CopilotSession> {
    const session = await client.createSession({
      workingDirectory: mindPath,
      enableConfigDiscovery: true,
      tools,
      systemMessage: {
        mode: 'customize',
        sections: {
          identity: { action: 'replace', content: systemMessage },
          tone: { action: 'remove' },
        },
      },
      // Return the old vocabulary ("approved") that CLI 1.0.36 expects.
      // SDK 0.3.0 renamed to "approve-once" but the CLI's internal
      // permission evaluator still switches on the pre-0.3.0 names.
      // The cast is intentional — the JSON-RPC layer doesn't type-check.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPermissionRequest: async () => ({ kind: 'approved' }) as any,
      onUserInputRequest: onUserInputRequest ?? (async () => ({ answer: 'Not available in this context', wasFreeform: true })),
    });

    return session;
  }

  async sendBackgroundPrompt(mindPath: string, prompt: string): Promise<void> {
    const mind = this.listMinds().find(m => m.mindPath === mindPath);
    if (!mind) return;
    const context = this.minds.get(mind.mindId);
    if (!context?.session) return;

    await context.session.send({ prompt });
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 120_000);
      const unsub = context.session?.on('session.idle', () => {
        clearTimeout(timeout);
        unsub?.();
        resolve();
      });
    });
  }

  private persistConfig(): void {
    if (this.reloading) return;
    const existingConfig = this.configService.load();
    const minds: MindRecord[] = Array.from(this.minds.values()).map(m => ({
      id: m.mindId,
      path: m.mindPath,
    }));
    const config: AppConfig = {
      version: 2,
      minds,
      activeMindId: this.activeMindId,
      activeLogin: existingConfig.activeLogin,
      theme: existingConfig.theme,
    };
    this.configService.save(config);
  }
}
