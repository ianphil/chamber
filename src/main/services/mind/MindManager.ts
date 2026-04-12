// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { MindContext, AppConfig, MindRecord } from '../../../shared/types';
import type { InternalMindContext } from './types';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import type { IdentityLoader } from '../chat/IdentityLoader';
import type { ExtensionLoader, LoadedExtension } from '../extensions/ExtensionLoader';
import { ExtensionLoader as ExtensionLoaderClass } from '../extensions/ExtensionLoader';
import { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
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

  async loadMind(mindPath: string): Promise<MindContext> {
    // Deduplicate
    const existingId = this.pathToId.get(mindPath);
    if (existingId && this.minds.has(existingId)) {
      return this.toPublic(this.minds.get(existingId)!);
    }

    // Validate
    this.validateMindPath(mindPath);

    // Generate ID
    const mindId = ConfigService.generateMindId(mindPath);

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
    const session = client.createSession({
      workingDirectory: mindPath,
      tools: tools as any[],
      systemMessage: {
        mode: 'customize',
        sectionOverrides: [
          { section: 'identity', override: { type: 'replace', content: identity.systemMessage } },
          { section: 'tone', override: { type: 'remove' } },
        ],
      },
      permissions: { autoApprove: true },
    });

    const context: InternalMindContext = {
      mindId,
      mindPath,
      identity,
      status: 'ready',
      client,
      session,
      extensions: loaded as any[],
    };

    this.minds.set(mindId, context);
    this.pathToId.set(mindPath, mindId);

    // Scan views
    await this.viewDiscovery.scan(mindPath);

    // Persist
    this.persistConfig();

    this.emit('mind:loaded', this.toPublic(context));
    return this.toPublic(context);
  }

  async unloadMind(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) return;

    // Cleanup extensions
    await ExtensionLoaderClass.cleanup(context.extensions);

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
    return Array.from(this.minds.values()).map(m => this.toPublic(m));
  }

  getMind(mindId: string): InternalMindContext | undefined {
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

    const session = context.client.createSession({
      workingDirectory: context.mindPath,
      tools: (context.extensions as any[]).flatMap((e: any) => e.tools ?? []),
      systemMessage: {
        mode: 'customize',
        sectionOverrides: [
          { section: 'identity', override: { type: 'replace', content: context.identity.systemMessage } },
          { section: 'tone', override: { type: 'remove' } },
        ],
      },
      permissions: { autoApprove: true },
    });

    context.session = session;
  }

  async restoreFromConfig(): Promise<void> {
    const config = this.configService.load();
    for (const record of config.minds) {
      try {
        const mind = await this.loadMind(record.path);
        // Override the generated ID with the persisted one for stability
        if (mind.mindId !== record.id) {
          this.rekey(mind.mindId, record.id);
        }
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
    const ids = Array.from(this.minds.keys());
    for (const id of ids) {
      await this.unloadMind(id);
    }
  }

  // --- Private helpers ---

  private validateMindPath(mindPath: string): void {
    const hasSoul = fs.existsSync(path.join(mindPath, 'SOUL.md'));
    const hasGithub = fs.existsSync(path.join(mindPath, '.github'));
    if (!hasSoul && !hasGithub) {
      throw new Error(`Invalid mind directory: ${mindPath} — must contain SOUL.md or .github/`);
    }
  }

  private toPublic(ctx: InternalMindContext): MindContext {
    return {
      mindId: ctx.mindId,
      mindPath: ctx.mindPath,
      identity: ctx.identity,
      status: ctx.status,
      error: ctx.error,
    };
  }

  private rekey(oldId: string, newId: string): void {
    const ctx = this.minds.get(oldId);
    if (!ctx) return;
    this.minds.delete(oldId);
    (ctx as any).mindId = newId;
    this.minds.set(newId, ctx);
    this.pathToId.set(ctx.mindPath, newId);
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
