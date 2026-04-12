// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { MindContext, AppConfig, MindRecord } from '../../../shared/types';
import type { InternalMindContext } from './types';
import { generateMindId } from './generateMindId';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ExtensionLoader } from '../extensions/ExtensionLoader';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
  private activeMindId: string | null = null;

  constructor(
    private readonly clientFactory: CopilotClientFactory,
    private readonly identityLoader: IdentityLoader,
    private readonly extensionLoader: ExtensionLoader,
    private readonly configService: ConfigService,
    private readonly viewDiscovery: ViewDiscovery,
  ) {
    super();
  }

  async loadMind(mindPath: string, mindId?: string): Promise<MindContext> {
    // Deduplicate — return existing mind
    const existingId = this.pathToId.get(mindPath);
    if (existingId && this.minds.has(existingId)) {
      return this.toExternalContext(this.minds.get(existingId)!);
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

    // Load extensions
    const { tools, loaded } = await this.extensionLoader.loadTools(mindPath);

    // Create session
    const session = await this.createSessionForMind(client, mindPath, identity.systemMessage, tools);

    const context: InternalMindContext = {
      mindId: id,
      mindPath,
      identity,
      status: 'ready',
      client,
      session,
      extensions: loaded,
    };

    this.minds.set(id, context);
    this.pathToId.set(mindPath, id);

    // Scan views
    await this.viewDiscovery.scan(mindPath);

    // Persist
    this.persistConfig();

    this.emit('mind:loaded', this.toExternalContext(context));
    return this.toExternalContext(context);
  }

  async unloadMind(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) return;

    // Cleanup extensions
    await this.extensionLoader.cleanupExtensions(context.extensions);

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

  async recreateSession(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const tools = context.extensions.flatMap((e: { tools?: unknown[] }) => e.tools ?? []);
    context.session = await this.createSessionForMind(
      context.client, context.mindPath, context.identity.systemMessage, tools,
    );
  }

  async restoreFromConfig(): Promise<void> {
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
      await this.extensionLoader.cleanupExtensions(context.extensions);
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
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async createSessionForMind(client: any, mindPath: string, systemMessage: string, tools: unknown[]): Promise<any> {
    return client.createSession({
      workingDirectory: mindPath,
      tools,
      systemMessage: {
        mode: 'customize',
        sectionOverrides: [
          { section: 'identity', override: { type: 'replace', content: systemMessage } },
          { section: 'tone', override: { type: 'remove' } },
        ],
      },
      onPermissionRequest: async () => ({ kind: 'approved' }),
      onUserInputRequest: async () => ({ answer: 'Not available in this context', wasFreeform: true }),
    });
  }

  async sendBackgroundPrompt(mindPath: string, prompt: string): Promise<void> {
    const mind = this.listMinds().find(m => m.mindPath === mindPath);
    if (!mind) return;
    const context = this.minds.get(mind.mindId);
    if (!context?.session) return;

    await context.session.send({ prompt });
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 120_000);
      const unsub = context.session!.on('session.idle', () => {
        clearTimeout(timeout);
        unsub();
        resolve();
      });
    });
  }

  private persistConfig(): void {
    const minds: MindRecord[] = Array.from(this.minds.values()).map(m => ({
      id: m.mindId,
      path: m.mindPath,
    }));
    const config: AppConfig = {
      version: 2,
      minds,
      activeMindId: this.activeMindId,
      theme: this.configService.load().theme,
    };
    this.configService.save(config);
  }
}
