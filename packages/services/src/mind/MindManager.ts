// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionHandler, ResumeSessionConfig, SessionConfig } from '@github/copilot-sdk';
import { Logger } from '../logger';

const log = Logger.create('MindManager');
import type { AppConfig, ChamberConversationRecord, ChatMessage, ConversationResumeResult, ConversationSummary, MindContext, MindRecord } from '@chamber/shared/types';
import type { InternalMindContext, CopilotClient, CopilotSession, Tool, UserInputHandler } from './types';
import { generateMindId } from './generateMindId';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveAllCompat } from '../sdk/approveAllCompat';
import type { IdentityLoader } from '../chat/IdentityLoader';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
  private knownMindRecords = new Map<string, MindRecord>();
  private activeMindId: string | null = null;
  private persistedActiveMindId: string | null = null;
  private restorePromise: Promise<void> | null = null;
  private reloading = false;
  private providers: ChamberToolProvider[] = [];
  private modelUpdates = new Map<string, Promise<void>>();

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
    const mindPathKey = this.mindPathKey(resolvedMindPath);

    // Deduplicate — return existing mind
    const existingId = this.pathToId.get(mindPathKey);
    if (existingId && this.minds.has(existingId)) {
      const existing = this.minds.get(existingId);
      if (!existing) throw new Error(`Mind ${existingId} not found`);
      return this.toExternalContext(existing);
    }

    // Concurrent guard — return in-flight promise
    const inflight = this.loading.get(mindPathKey);
    if (inflight) return inflight;

    const promise = this.doLoadMind(resolvedMindPath, mindId);
    this.loading.set(mindPathKey, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(mindPathKey);
    }
  }

  private async doLoadMind(mindPath: string, mindId?: string): Promise<MindContext> {
    const resolvedMindPath = this.resolveMindPath(mindPath);
    const mindPathKey = this.mindPathKey(resolvedMindPath);

    // Use provided ID or generate a new one
    const id = mindId ?? generateMindId(resolvedMindPath);

    // Load identity
    const identity = this.identityLoader.load(resolvedMindPath);
    if (!identity) {
      throw new Error(`Failed to load identity from ${resolvedMindPath}`);
    }

    try {
      bootstrapMindCapabilities(resolvedMindPath);
    } catch (err) {
      log.warn('Mind capability bootstrap failed (non-fatal):', err);
    }

    // Create client
    const client = await this.clientFactory.createClient(resolvedMindPath);

    const sessionTools = this.getSessionTools(id, resolvedMindPath);

    const knownRecord = this.knownMindRecords.get(id);
    const selectedModel = knownRecord?.selectedModel;
    const activeSessionId = knownRecord?.activeSessionId ?? this.createConversationRecord(id).sessionId;
    const conversationRecord = this.ensureConversationRecord(id, activeSessionId, knownRecord?.conversations);

    const session = knownRecord?.activeSessionId
      ? await this.resumeSessionForMind(
        client,
        activeSessionId,
        resolvedMindPath,
        identity.systemMessage,
        sessionTools,
        undefined,
        approveAllCompat,
        true,
        selectedModel,
      ).catch(() => this.createSessionForMind(
        client,
        resolvedMindPath,
        identity.systemMessage,
        sessionTools,
        undefined,
        approveAllCompat,
        true,
        selectedModel,
        activeSessionId,
      ))
      : await this.createSessionForMind(
      client,
      resolvedMindPath,
      identity.systemMessage,
      sessionTools,
      undefined,
      approveAllCompat,
      true,
      selectedModel,
      activeSessionId,
    );

    const context: InternalMindContext = {
      mindId: id,
      mindPath: resolvedMindPath,
      identity,
      status: 'ready',
      selectedModel,
      activeSessionId,
      client,
      session,
    };

    this.minds.set(id, context);
    this.pathToId.set(mindPathKey, id);

    try {
      await Promise.all([
        this.activateProviders(id, resolvedMindPath),
        this.viewDiscovery.scan(resolvedMindPath),
      ]);
      this.viewDiscovery.startWatching(resolvedMindPath, () => {
        this.emit('lens:viewsChanged', this.viewDiscovery.getViews(resolvedMindPath), id);
      });
    } catch (err) {
      this.minds.delete(id);
      this.pathToId.delete(mindPathKey);
      this.viewDiscovery.removeMind(resolvedMindPath);
      await this.releaseProviders(id).catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
      throw err;
    }

    this.knownMindRecords.set(id, {
      id,
      path: resolvedMindPath,
      ...(selectedModel ? { selectedModel } : {}),
      activeSessionId,
      conversations: [
        conversationRecord,
        ...(knownRecord?.conversations ?? []).filter((conversation) => conversation.sessionId !== activeSessionId),
      ],
    });

    // Persist
    this.persistConfig();

    this.emit('mind:loaded', this.toExternalContext(context));
    return this.toExternalContext(context);
  }

  async unloadMind(mindId: string): Promise<void> {
    const context = this.minds.get(mindId);
    if (!context) {
      const removedKnownRecord = this.knownMindRecords.delete(mindId);
      if (!removedKnownRecord) return;
      if (this.persistedActiveMindId === mindId) {
        this.persistedActiveMindId = this.activeMindId;
      }
      this.persistConfig();
      this.emit('mind:unloaded', mindId);
      return;
    }

    await this.releaseProviders(mindId);

    // Destroy client
    await this.clientFactory.destroyClient(context.client);

    // Remove views/watchers
    this.viewDiscovery.removeMind(context.mindPath);

    // Remove from maps
    this.minds.delete(mindId);
    this.pathToId.delete(this.mindPathKey(context.mindPath));
    this.knownMindRecords.delete(mindId);

    // Update active mind if needed
    if (this.activeMindId === mindId) {
      const remaining = Array.from(this.minds.keys());
      this.activeMindId = remaining.length > 0 ? remaining[0] : null;
    }
    if (this.persistedActiveMindId === mindId) {
      this.persistedActiveMindId = this.activeMindId;
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
      this.persistedActiveMindId = mindId;
    }
  }

  getActiveMindId(): string | null {
    return this.activeMindId;
  }

  async recreateSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const conversation = this.createConversationRecord(mindId);
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = await this.createSessionForMind(
      context.client,
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      undefined,
      approveAllCompat,
      true,
      context.selectedModel,
      conversation.sessionId,
    );
    context.session = nextSession;
    context.activeSessionId = conversation.sessionId;
    this.upsertConversationRecord(mindId, conversation);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    return context.session;
  }

  async resumeConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record?.conversations?.some((conversation) => conversation.sessionId === sessionId)) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = await this.resumeSessionForMind(
      context.client,
      sessionId,
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      undefined,
      approveAllCompat,
      true,
      context.selectedModel,
    );
    context.session = nextSession;
    context.activeSessionId = sessionId;
    this.touchConversationRecord(mindId, sessionId);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });

    return {
      sessionId,
      messages: await this.getMessagesForSession(nextSession),
      conversations: this.listConversationHistory(mindId),
    };
  }

  listConversationHistory(mindId: string): ConversationSummary[] {
    const context = this.minds.get(mindId);
    const record = this.knownMindRecords.get(mindId);
    const activeSessionId = context?.activeSessionId ?? record?.activeSessionId;
    return [...(record?.conversations ?? [])]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((conversation) => ({
        sessionId: conversation.sessionId,
        title: conversation.title ?? this.defaultConversationTitle(conversation),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        kind: conversation.kind,
        active: conversation.sessionId === activeSessionId,
      }));
  }

  renameConversation(mindId: string, sessionId: string, title: string): ConversationSummary[] {
    const record = this.knownMindRecords.get(mindId);
    if (!record) throw new Error(`Mind ${mindId} not found`);
    const conversations = record.conversations ?? [];
    if (!conversations.some((conversation) => conversation.sessionId === sessionId)) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }
    const updatedAt = new Date().toISOString();
    this.knownMindRecords.set(mindId, {
      ...record,
      conversations: conversations.map((conversation) => conversation.sessionId === sessionId
        ? { ...conversation, title: title.trim(), updatedAt }
        : conversation),
    });
    this.persistConfig();
    return this.listConversationHistory(mindId);
  }

  async setMindModel(mindId: string, model: string | null): Promise<MindContext | null> {
    const previousUpdate = this.modelUpdates.get(mindId) ?? Promise.resolve();
    let releaseUpdate: () => void;
    const currentUpdate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const queuedUpdate = previousUpdate.then(() => currentUpdate, () => currentUpdate);
    this.modelUpdates.set(mindId, queuedUpdate);
    await previousUpdate.catch(() => { /* previous caller observes its own failure */ });

    try {
      return await this.setMindModelUnlocked(mindId, model);
    } finally {
      releaseUpdate!();
      if (this.modelUpdates.get(mindId) === queuedUpdate) {
        this.modelUpdates.delete(mindId);
      }
    }
  }

  private async setMindModelUnlocked(mindId: string, model: string | null): Promise<MindContext | null> {
    const context = this.minds.get(mindId);
    const selectedModel = model && model.trim().length > 0 ? model.trim() : undefined;

    if (!context) {
      const existingRecord = this.knownMindRecords.get(mindId);
      if (!existingRecord) return null;
      this.knownMindRecords.set(mindId, {
        id: existingRecord.id,
        path: existingRecord.path,
        ...(selectedModel ? { selectedModel } : {}),
        ...(existingRecord.activeSessionId ? { activeSessionId: existingRecord.activeSessionId } : {}),
        ...(existingRecord.conversations ? { conversations: existingRecord.conversations } : {}),
      });
      this.persistConfig();
      return null;
    }

    if (context.selectedModel === selectedModel) return this.toExternalContext(context);

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = context.activeSessionId
      ? await this.resumeSessionForMind(
        context.client,
        context.activeSessionId,
        context.mindPath,
        context.identity.systemMessage,
        sessionTools,
        undefined,
        approveAllCompat,
        true,
        selectedModel,
      )
      : await this.createSessionForMind(
        context.client,
        context.mindPath,
        context.identity.systemMessage,
        sessionTools,
        undefined,
        approveAllCompat,
        true,
        selectedModel,
      );

    context.selectedModel = selectedModel;
    context.session = nextSession;
    this.knownMindRecords.set(mindId, {
      id: mindId,
      path: context.mindPath,
      ...(selectedModel ? { selectedModel } : {}),
      ...(context.activeSessionId ? { activeSessionId: context.activeSessionId } : {}),
      ...(this.knownMindRecords.get(mindId)?.conversations ? { conversations: this.knownMindRecords.get(mindId)?.conversations } : {}),
    });
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });

    const external = this.toExternalContext(context);
    this.emit('mind:loaded', external);
    return external;
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
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
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
    this.knownMindRecords = new Map(config.minds.map(record => [record.id, { ...record }]));
    this.persistedActiveMindId = config.activeMindId;
    for (const record of config.minds) {
      try {
        await this.loadMind(record.path, record.id);
      } catch (err) {
        log.error(`Failed to restore mind at ${record.path}:`, err);
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

  private mindPathKey(mindPath: string): string {
    let resolved = path.resolve(mindPath);
    try {
      resolved = fs.realpathSync.native(resolved);
    } catch {
      // If the folder disappears mid-load, keep the resolved path so the caller
      // gets the real load error instead of masking it with canonicalization.
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private toExternalContext(ctx: InternalMindContext): MindContext {
    return {
      mindId: ctx.mindId,
      mindPath: ctx.mindPath,
      identity: ctx.identity,
      status: ctx.status,
      error: ctx.error,
      selectedModel: ctx.selectedModel,
      activeSessionId: ctx.activeSessionId,
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
    model?: string,
    sessionId?: string,
  ): Promise<CopilotSession> {
    const sessionConfig: SessionConfig = {
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
      ...(sessionId ? { sessionId } : {}),
      ...(model ? { model } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
    };
    const session = await client.createSession(sessionConfig);

    if (approveAll) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }

    return session;
  }

  private async resumeSessionForMind(
    client: CopilotClient,
    sessionId: string,
    mindPath: string,
    systemMessage: string,
    tools: Tool[],
    onUserInputRequest?: UserInputHandler,
    onPermissionRequest: PermissionHandler = approveAllCompat,
    approveAll = true,
    model?: string,
  ): Promise<CopilotSession> {
    const sessionConfig: ResumeSessionConfig = {
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
      ...(model ? { model } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
    };
    const session = await client.resumeSession(sessionId, sessionConfig);
    if (approveAll) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }
    return session;
  }

  private async getMessagesForSession(session: CopilotSession): Promise<ChatMessage[]> {
    const events = await session.getMessages();
    return events.flatMap((event, index) => this.mapSessionEventToChatMessage(event, index));
  }

  private mapSessionEventToChatMessage(event: unknown, index: number): ChatMessage[] {
    if (typeof event !== 'object' || event === null) return [];
    const record = event as Record<string, unknown>;
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data as Record<string, unknown>
      : {};
    const content = this.extractMessageContent(data);
    if (!content) return [];
    const timestamp = typeof record.timestamp === 'number'
      ? record.timestamp
      : Date.parse(String(record.timestamp ?? '')) || Date.now();
    const id = typeof data.messageId === 'string'
      ? data.messageId
      : `${String(record.type ?? 'session-event')}-${index}`;
    if (record.type === 'user.message') {
      return [{ id, role: 'user', blocks: [{ type: 'text', content }], timestamp }];
    }
    if (record.type === 'assistant.message') {
      return [{ id, role: 'assistant', blocks: [{ type: 'text', content }], timestamp }];
    }
    return [];
  }

  private extractMessageContent(data: Record<string, unknown>): string | null {
    const value = data.content ?? data.message ?? data.text ?? data.prompt;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const content = value
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item !== 'object' || item === null) return '';
          const block = item as Record<string, unknown>;
          return typeof block.text === 'string' ? block.text : '';
        })
        .filter(Boolean)
        .join('\n');
      return content || null;
    }
    return null;
  }

  async sendBackgroundPrompt(mindPath: string, prompt: string): Promise<void> {
    const requestedMindPathKey = this.mindPathKey(mindPath);
    const mind = this.listMinds().find(m => this.mindPathKey(m.mindPath) === requestedMindPathKey);
    if (!mind) return;
    const context = this.minds.get(mind.mindId);
    if (!context?.session) return;

    await context.session.send({ prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) });
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
    const config: AppConfig = {
      version: 2,
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
      activeLogin: existingConfig.activeLogin,
      theme: existingConfig.theme,
    };
    this.configService.save(config);
  }

  private getPersistedMindRecords(): MindRecord[] {
    const records = new Map(this.knownMindRecords);
    for (const mind of this.minds.values()) {
      records.set(mind.mindId, {
        id: mind.mindId,
        path: mind.mindPath,
        ...(mind.selectedModel ? { selectedModel: mind.selectedModel } : {}),
        ...(mind.activeSessionId ? { activeSessionId: mind.activeSessionId } : {}),
        ...(this.knownMindRecords.get(mind.mindId)?.conversations ? { conversations: this.knownMindRecords.get(mind.mindId)?.conversations } : {}),
      });
    }
    return Array.from(records.values());
  }

  private createConversationRecord(mindId: string): ChamberConversationRecord {
    const now = new Date().toISOString();
    return {
      sessionId: `chamber-${mindId}-${randomUUID()}`,
      title: `New chat · ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      kind: 'chat',
    };
  }

  private ensureConversationRecord(
    mindId: string,
    sessionId: string,
    conversations: ChamberConversationRecord[] = [],
  ): ChamberConversationRecord {
    return conversations.find((conversation) => conversation.sessionId === sessionId)
      ?? {
        sessionId,
        title: `New chat · ${new Date().toLocaleString()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kind: 'chat',
      };
  }

  private upsertConversationRecord(mindId: string, conversation: ChamberConversationRecord): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    const conversations = record.conversations ?? [];
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: conversation.sessionId,
      conversations: [
        conversation,
        ...conversations.filter((existing) => existing.sessionId !== conversation.sessionId),
      ],
    });
  }

  private touchConversationRecord(mindId: string, sessionId: string): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    const updatedAt = new Date().toISOString();
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: sessionId,
      conversations: (record.conversations ?? []).map((conversation) => conversation.sessionId === sessionId
        ? { ...conversation, updatedAt }
        : conversation),
    });
  }

  private defaultConversationTitle(conversation: ChamberConversationRecord): string {
    return `Chat · ${new Date(conversation.createdAt).toLocaleString()}`;
  }

  private getPersistedActiveMindId(): string | null {
    if (
      this.persistedActiveMindId &&
      (this.minds.has(this.persistedActiveMindId) || this.knownMindRecords.has(this.persistedActiveMindId))
    ) {
      return this.persistedActiveMindId;
    }
    return this.activeMindId;
  }
}
