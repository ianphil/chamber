// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionHandler } from '@github/copilot-sdk';
import type { MindContext, AppConfig, MindRecord } from '@chamber/shared/types';
import type { InternalMindContext, CopilotClient, CopilotSession, Tool, UserInputHandler } from './types';
import { generateMindId } from './generateMindId';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveAllCompat } from '../sdk/approveAllCompat';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
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
    const resolvedMindPath = this.resolveMindPath(mindPath);

    // Deduplicate — return existing mind
    const existingId = this.pathToId.get(resolvedMindPath);
    if (existingId && this.minds.has(existingId)) {
      const existing = this.minds.get(existingId);
      if (!existing) throw new Error(`Mind ${existingId} not found`);
      return this.toExternalContext(existing);
    }

    // Concurrent guard — return in-flight promise
    const inflight = this.loading.get(resolvedMindPath);
    if (inflight) return inflight;

    const promise = this.doLoadMind(resolvedMindPath, mindId);
    this.loading.set(resolvedMindPath, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(resolvedMindPath);
    }
  }

  private async doLoadMind(mindPath: string, mindId?: string): Promise<MindContext> {
    const resolvedMindPath = this.resolveMindPath(mindPath);

    // Use provided ID or generate a new one
    const id = mindId ?? generateMindId(resolvedMindPath);

    // Load identity
    const identity = this.identityLoader.load(resolvedMindPath);
    if (!identity) {
      throw new Error(`Failed to load identity from ${resolvedMindPath}`);
    }

    // Create client
    const client = await this.clientFactory.createClient(resolvedMindPath);

    const sessionTools = this.getSessionTools(id, resolvedMindPath);

    // Create session
    const session = await this.createSessionForMind(client, resolvedMindPath, identity.systemMessage, sessionTools);

    const context: InternalMindContext = {
      mindId: id,
      mindPath: resolvedMindPath,
      identity,
      status: 'ready',
      client,
      session,
    };

    this.minds.set(id, context);
    this.pathToId.set(resolvedMindPath, id);

    try {
      await Promise.all([
        this.activateProviders(id, resolvedMindPath),
        this.viewDiscovery.scan(resolvedMindPath),
      ]);
      this.viewDiscovery.startWatching(resolvedMindPath, () => {
        this.emit('lens:viewsChanged', this.viewDiscovery.getViews());
      });
    } catch (err) {
      this.minds.delete(id);
      this.pathToId.delete(resolvedMindPath);
      this.viewDiscovery.removeMind(resolvedMindPath);
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

  private resolveMindPath(mindPath: string): string {
    let current = mindPath;

    while (true) {
      if (this.isMindPath(current)) return current;

      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Invalid mind directory: ${mindPath} — must contain SOUL.md or .github/`);
      }

      current = parent;
    }
  }

  private isMindPath(mindPath: string): boolean {
    const hasSoul = fs.existsSync(path.join(mindPath, 'SOUL.md'));
    const hasGithub = fs.existsSync(path.join(mindPath, '.github'));
    return hasSoul || hasGithub;
  }

  private toExternalContext(ctx: InternalMindContext): MindContext {
    return {
      mindId: ctx.mindId,
      mindPath: ctx.mindPath,
      identity: ctx.identity,
      status: ctx.status,
      error: ctx.error,
      windowed: false,
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

  async createChatroomSession(mindId: string, onPermissionRequest?: PermissionHandler): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind(
      context.client,
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      undefined,
      onPermissionRequest,
      !onPermissionRequest,
    );
  }

  private async createSessionForMind(
    client: CopilotClient,
    mindPath: string,
    systemMessage: string,
    tools: Tool[],
    onUserInputRequest?: UserInputHandler,
    onPermissionRequest: PermissionHandler = approveAllCompat,
    approveAll = true,
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
      onPermissionRequest,
      onUserInputRequest: onUserInputRequest ?? (async () => ({ answer: 'Not available in this context', wasFreeform: true })),
    });

    if (approveAll) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }

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
