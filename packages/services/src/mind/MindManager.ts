// MindManager — aggregate root for multi-mind runtime.
// Owns Map<mindId, InternalMindContext>, lifecycle, persistence.

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PermissionHandler, ResumeSessionConfig, SessionConfig } from '@github/copilot-sdk';
import { parseModelSelectionKey } from '@chamber/shared/model-selection';
import { isStaleSessionError } from '@chamber/shared/sessionErrors';
import type { AppConfig, ChamberConversationRecord, ChatMessage, ConversationResumeResult, ConversationSummary, MindContext, MindRecord, ModelProvider, ModelSelection } from '@chamber/shared/types';
import { Logger } from '../logger';
import type { InternalMindContext, CopilotClient, CopilotSession, Tool, UserInputHandler } from './types';
import { generateMindId } from './generateMindId';
import { loadMcpServersFromMindPath } from './mcpConfig';
import { loadChamberMindConfig } from './chamberMindConfig';
import type { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import type { IdentityLoader } from '../chat/IdentityLoader';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext, stripInjectedCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import type { ChamberToolProvider } from '../chamberTools';
import type { ConfigService } from '../config/ConfigService';
import type { ViewDiscovery } from '../lens/ViewDiscovery';
import { bootstrapMindCapabilities } from '../lens/MindBootstrap';
import type { SdkProviderConfig } from '../byo-llm/buildProviderConfig';
import { MindScaffold } from '../genesis/MindScaffold';
import type { ManagedSkillService } from '../skills/ManagedSkillService';

const log = Logger.create('MindManager');
const COPILOT_RUNTIME_CONFIG_DIR = 'copilot-runtime';
const ISOLATED_PROMPT_TIMEOUT_MS = 120_000;

type MindSessionKind = 'conversation' | 'task' | 'chatroom' | 'isolated-prompt';

interface MindSessionPolicy {
  persistsConversation: boolean;
  ownsActiveSession: boolean;
  disconnectsAfterUse: boolean;
  purpose: string;
}

interface CreateMindSessionRequest {
  kind: MindSessionKind;
  client: CopilotClient;
  mindPath: string;
  systemMessage: string;
  tools: Tool[];
  onUserInputRequest?: UserInputHandler;
  onPermissionRequest?: PermissionHandler;
  useSetApproveAllShortcut?: boolean;
  model?: string;
  modelProvider?: ModelProvider;
  sessionId?: string;
}

const MIND_SESSION_POLICIES: Record<MindSessionKind, MindSessionPolicy> = {
  conversation: {
    persistsConversation: true,
    ownsActiveSession: true,
    disconnectsAfterUse: false,
    purpose: 'Interactive mind chat persisted in Chamber conversation history.',
  },
  task: {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: false,
    purpose: 'Ephemeral task session for SDK task execution surfaces.',
  },
  chatroom: {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: false,
    purpose: 'Ephemeral multi-agent chatroom participant session.',
  },
  'isolated-prompt': {
    persistsConversation: false,
    ownsActiveSession: false,
    disconnectsAfterUse: true,
    purpose: 'Ephemeral automation request/response session isolated from active chat.',
  },
};

export class MindManager extends EventEmitter {
  private minds = new Map<string, InternalMindContext>();
  private pathToId = new Map<string, string>();
  private loading = new Map<string, Promise<MindContext>>();
  // Lowercased+NFC display names held by in-flight `loadMind({enforceUnique:true})`
  // calls. Two concurrent uniqueness-enforcing loads with colliding identity
  // names would otherwise both pass the `this.minds`-only check because neither
  // is in `this.minds` until much later in `doLoadMind`. The reservation closes
  // that race so exactly one of the concurrent loads succeeds.
  private pendingNames = new Set<string>();
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
    /**
     * BYO LLM SDK provider config. Returns the config when BYO is enabled and
     * configured, or null when the bundled GitHub Copilot model catalog should
     * be used.
     *
     * This is the AUTHORITATIVE BYOK activation path for SDK-spawned CLI
     * processes — `provider` MUST be passed into `client.createSession({...})`
     * for the CLI to route inference to the BYO endpoint. The CLI's
     * `COPILOT_PROVIDER_*` env vars only affect standalone CLI invocations,
     * NOT the SDK's `createSession` server-mode path. See
     *   node_modules/@github/copilot-sdk/dist/types.d.ts (ProviderConfig)
     *   https://github.com/github/copilot-sdk/blob/main/nodejs/README.md#custom-providers
     * for the contract.
     */
    private readonly byoProviderConfigProvider: () => SdkProviderConfig | null = () => null,
    /**
     * Default model fallback for BYO LLM. Returns the saved BYO config's model
     * field, used when a mind has no per-mind selectedModel. Required because
     * the SDK rejects createSession({provider}) without a model argument.
     */
    private readonly byoDefaultModelProvider: () => string | undefined = () => undefined,
    private readonly managedSkillService?: Pick<ManagedSkillService, 'installIntoMind'>,
  ) {
    super();
  }

  setProviders(providers: ChamberToolProvider[]): void {
    this.providers = [...providers];
  }

  async loadMind(
    mindPath: string,
    mindId?: string,
    options?: { enforceUnique?: boolean },
  ): Promise<MindContext> {
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

    const promise = this.doLoadMind(resolvedMindPath, mindId, options);
    this.loading.set(mindPathKey, promise);
    try {
      return await promise;
    } finally {
      this.loading.delete(mindPathKey);
    }
  }

  private async doLoadMind(
    mindPath: string,
    mindId?: string,
    options?: { enforceUnique?: boolean },
  ): Promise<MindContext> {
    const resolvedMindPath = this.resolveMindPath(mindPath);
    const mindPathKey = this.mindPathKey(resolvedMindPath);

    // Use provided ID or generate a new one
    const id = mindId ?? generateMindId(resolvedMindPath);

    // Load identity
    const identity = this.identityLoader.load(resolvedMindPath);
    if (!identity) {
      throw new Error(`Failed to load identity from ${resolvedMindPath}`);
    }

    // Issue #44 — display-name uniqueness check. Done after identity load
    // and BEFORE clientFactory.createClient so a rejected load does not
    // spawn an SDK subprocess that has to be torn down. Opt-in via
    // `options.enforceUnique` so app-startup replay of persisted records
    // (which may contain legitimate pre-existing duplicates) is unaffected.
    //
    // The `pendingNames` reservation closes the race where two concurrent
    // enforce-unique loads each see an empty `this.minds` for the colliding
    // name (the actual set+get into `this.minds` happens much later, after
    // client/session setup). Without the reservation both would succeed.
    let reservedName: string | undefined;
    if (options?.enforceUnique) {
      const collision = this.findByName(identity.name);
      if (collision && this.mindPathKey(collision.mindPath) !== mindPathKey) {
        throw new Error(
          `An agent named "${identity.name}" already exists. Choose a different name.`,
        );
      }
      const needle = MindManager.nameKey(identity.name);
      if (needle && this.pendingNames.has(needle)) {
        throw new Error(
          `An agent named "${identity.name}" already exists. Choose a different name.`,
        );
      }
      if (needle) {
        this.pendingNames.add(needle);
        reservedName = needle;
      }
    }

    try {
      return await this.doLoadMindInner(resolvedMindPath, mindPathKey, id, identity);
    } finally {
      if (reservedName) this.pendingNames.delete(reservedName);
    }
  }

  private async doLoadMindInner(
    resolvedMindPath: string,
    mindPathKey: string,
    id: string,
    identity: NonNullable<ReturnType<IdentityLoader['load']>>,
  ): Promise<MindContext> {

    try {
      MindScaffold.ensureChamberGitignore(resolvedMindPath);
    } catch (err) {
      log.warn('Mind .chamber gitignore migration failed (non-fatal):', err);
    }

    try {
      bootstrapMindCapabilities(resolvedMindPath);
    } catch (err) {
      log.warn('Mind capability bootstrap failed (non-fatal):', err);
    }

    if (this.managedSkillService) {
      try {
        await this.managedSkillService.installIntoMind(resolvedMindPath);
      } catch (err) {
        log.warn('Marketplace managed skill install failed (non-fatal):', err);
      }
    }

    // Create client (no env-var BYOK plumbing — provider is passed via SessionConfig.provider on createSession)
    const client = await this.clientFactory.createClient(resolvedMindPath);

    const sessionTools = this.getSessionTools(id, resolvedMindPath);

    const knownRecord = this.knownMindRecords.get(id);
    const { selectedModel, selectedModelProvider } = this.getRestorableModelSelection(id, knownRecord);
    const activeSessionId = knownRecord?.activeSessionId ?? this.createConversationRecord(id).sessionId;
    const conversationRecord = this.ensureConversationRecord(id, activeSessionId, knownRecord?.conversations);
    const session = knownRecord?.activeSessionId
      ? await this.loadConversationSession(
        client,
        'conversation',
        resolvedMindPath,
        identity.systemMessage,
        sessionTools,
        conversationRecord.sessionId,
        selectedModel,
        selectedModelProvider,
      )
      : await this.createSessionForMind({
        kind: 'conversation',
        client,
        mindPath: resolvedMindPath,
        systemMessage: identity.systemMessage,
        tools: sessionTools,
        model: selectedModel,
        modelProvider: selectedModelProvider,
        sessionId: activeSessionId,
      });

    const context: InternalMindContext = {
      mindId: id,
      mindPath: resolvedMindPath,
      identity,
      status: 'ready',
      selectedModel,
      selectedModelProvider,
      activeSessionId,
      client,
      session,
    };

    this.minds.set(id, context);
    this.pathToId.set(mindPathKey, id);

    // Capture pre-existing knownRecord so the rollback can restore it
    // rather than wiping a real record on a late failure.
    const previousKnownRecord = this.knownMindRecords.get(id);

    try {
      await Promise.all([
        this.activateProviders(id, resolvedMindPath),
        this.viewDiscovery.scan(resolvedMindPath),
      ]);
      this.viewDiscovery.startWatching(resolvedMindPath, () => {
        this.emit('lens:viewsChanged', this.viewDiscovery.getViews(resolvedMindPath), id);
      });

      this.knownMindRecords.set(id, {
        id,
        path: resolvedMindPath,
        ...(selectedModel ? { selectedModel } : {}),
        ...(selectedModelProvider ? { selectedModelProvider } : {}),
        activeSessionId,
        conversations: [
          conversationRecord,
          ...(knownRecord?.conversations ?? []).filter((conversation) => conversation.sessionId !== activeSessionId),
        ],
      });

      this.persistConfig();
    } catch (err) {
      this.minds.delete(id);
      this.pathToId.delete(mindPathKey);
      this.viewDiscovery.removeMind(resolvedMindPath);
      if (previousKnownRecord) {
        this.knownMindRecords.set(id, previousKnownRecord);
      } else {
        this.knownMindRecords.delete(id);
      }
      await this.releaseProviders(id).catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
      throw err;
    }

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

  async reloadMind(mindId: string): Promise<MindContext> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const mindPath = context.mindPath;
    const knownRecord = this.knownMindRecords.get(mindId);
    const wasActive = this.activeMindId === mindId;

    await this.releaseProviders(mindId);
    await this.clientFactory.destroyClient(context.client);
    this.viewDiscovery.removeMind(context.mindPath);
    this.minds.delete(mindId);
    this.pathToId.delete(this.mindPathKey(context.mindPath));
    if (knownRecord) this.knownMindRecords.set(mindId, knownRecord);

    this.emit('mind:unloaded', mindId);
    const reloaded = await this.loadMind(mindPath, mindId);
    if (wasActive) this.setActiveMind(mindId);
    return reloaded;
  }

  listMinds(): MindContext[] {
    return Array.from(this.minds.values()).map(m => this.toExternalContext(m));
  }

  /**
   * Case-insensitive lookup of a loaded mind by its display name. Used by
   * IPC adapters to detect duplicate-name collisions during agent creation
   * (issue #44) before the user commits to a new mind directory. Returns
   * `undefined` if no loaded mind has a name matching `name`.
   *
   * Names are compared after NFC normalization, trim, and lowercase so that
   * cross-platform paste differences (macOS NFD vs Windows NFC for accented
   * names like "Café") don't slip a duplicate past the check.
   */
  findByName(name: string): MindContext | undefined {
    const needle = MindManager.nameKey(name);
    if (!needle) return undefined;
    for (const internal of this.minds.values()) {
      if (MindManager.nameKey(internal.identity.name) === needle) {
        return this.toExternalContext(internal);
      }
    }
    return undefined;
  }

  private static nameKey(name: string): string {
    return name.normalize('NFC').trim().toLowerCase();
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
    const activeConversation = this.getActiveConversationRecord(mindId);
    const replaceSessionId = activeConversation?.hasMessages === false
      ? activeConversation.sessionId
      : undefined;

    return this.createNewConversationSession(mindId, context, replaceSessionId);
  }

  async recoverActiveConversationSession(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const activeConversation = this.getActiveConversationRecord(mindId);
    if (activeConversation?.hasMessages === false) {
      return this.recreateSession(mindId);
    }
    if (!context.activeSessionId) {
      return this.createNewConversationSession(mindId, context);
    }
    if (!activeConversation) {
      this.upsertConversationRecord(mindId, this.ensureConversationRecord(mindId, context.activeSessionId));
    }

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const recoveredSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      context.activeSessionId,
      context.selectedModel,
      context.selectedModelProvider,
    );
    context.session = recoveredSession;
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    return recoveredSession;
  }

  async startNewConversation(mindId: string): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const refreshedIdentity = this.identityLoader.load(context.mindPath);
    const identityChanged = refreshedIdentity !== null
      && refreshedIdentity.systemMessage !== context.identity.systemMessage;
    if (identityChanged) {
      context.identity = refreshedIdentity;
    }
    const activeConversation = this.getActiveConversationRecord(mindId);
    if (activeConversation?.hasMessages === false && context.session && !identityChanged) {
      return context.session;
    }

    if (activeConversation?.hasMessages === false && context.session && identityChanged) {
      // Recreate the SDK session so the model picks up the refreshed system message
      // (e.g. newly installed marketplace tools advertised in ## Tools).
      return this.createNewConversationSession(mindId, context, activeConversation.sessionId);
    }

    return this.createNewConversationSession(mindId, context);
  }

  markActiveConversationHasMessages(mindId: string, prompt: string): void {
    const context = this.minds.get(mindId);
    if (!context?.activeSessionId) return;
    const record = this.knownMindRecords.get(mindId);
    if (!record?.conversations) return;
    const updatedAt = new Date().toISOString();
    const title = this.conversationTitleFromPrompt(prompt);
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: context.activeSessionId,
      conversations: record.conversations.map((conversation) => {
        if (conversation.sessionId !== context.activeSessionId) return conversation;
        const shouldReplaceTitle = !conversation.title || conversation.title.startsWith('New chat · ');
        return {
          ...conversation,
          ...(shouldReplaceTitle ? { title } : {}),
          hasMessages: true,
          updatedAt,
        };
      }),
    });
    this.persistConfig();
  }

  private async createNewConversationSession(
    mindId: string,
    context: InternalMindContext,
    replaceSessionId?: string,
  ): Promise<CopilotSession> {
    const refreshedIdentity = this.identityLoader.load(context.mindPath);
    if (refreshedIdentity) {
      context.identity = refreshedIdentity;
    }
    const conversation = this.createConversationRecord(mindId);
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = await this.createSessionForMind({
      kind: 'conversation',
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
      sessionId: conversation.sessionId,
    });
    context.session = nextSession;
    context.activeSessionId = conversation.sessionId;
    this.upsertConversationRecord(mindId, conversation, replaceSessionId);
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

    if (context.activeSessionId === sessionId && context.session) {
      this.touchConversationRecord(mindId, sessionId);
      this.persistConfig();
      return {
        sessionId,
        messages: await this.getMessagesForSession(context.session),
        conversations: this.listConversationHistory(mindId),
      };
    }

    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const conversation = record.conversations.find((candidate) => candidate.sessionId === sessionId);
    if (!conversation) throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    const nextSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      conversation.sessionId,
      context.selectedModel,
      context.selectedModelProvider,
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
        hasMessages: conversation.hasMessages,
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

  async deleteConversation(mindId: string, sessionId: string): Promise<ConversationResumeResult> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);
    const record = this.knownMindRecords.get(mindId);
    if (!record) throw new Error(`Mind ${mindId} not found`);
    const conversations = record.conversations ?? [];
    const deletingConversation = conversations.find((conversation) => conversation.sessionId === sessionId);
    if (!deletingConversation) {
      throw new Error(`Conversation ${sessionId} not found for mind ${mindId}`);
    }

    const remainingConversations = conversations.filter((conversation) => conversation.sessionId !== sessionId);
    if (context.activeSessionId !== sessionId) {
      this.knownMindRecords.set(mindId, {
        ...record,
        conversations: remainingConversations,
      });
      this.persistConfig();
      await this.deleteSdkSession(context, deletingConversation.sessionId);
      return {
        sessionId: context.activeSessionId ?? '',
        messages: context.session ? await this.getMessagesForSession(context.session) : [],
        conversations: this.listConversationHistory(mindId),
      };
    }

    const { activeSessionId: _deletedActiveSessionId, ...recordWithoutActiveSession } = record;
    void _deletedActiveSessionId;
    this.knownMindRecords.set(mindId, {
      ...recordWithoutActiveSession,
      conversations: remainingConversations,
    });

    if (remainingConversations.length === 0) {
      await this.createNewConversationSession(mindId, context);
      await this.deleteSdkSession(context, deletingConversation.sessionId);
      return {
        sessionId: context.activeSessionId ?? '',
        messages: [],
        conversations: this.listConversationHistory(mindId),
      };
    }

    const nextConversation = [...remainingConversations]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const previousSession = context.session;
    const sessionTools = this.getSessionTools(mindId, context.mindPath);
    const nextSession = await this.loadConversationSession(
      context.client,
      'conversation',
      context.mindPath,
      context.identity.systemMessage,
      sessionTools,
      nextConversation.sessionId,
      context.selectedModel,
      context.selectedModelProvider,
    );
    context.session = nextSession;
    context.activeSessionId = nextConversation.sessionId;
    this.touchConversationRecord(mindId, nextConversation.sessionId);
    this.persistConfig();
    await previousSession?.disconnect().catch(() => { /* session already disconnected */ });
    await this.deleteSdkSession(context, deletingConversation.sessionId);

    return {
      sessionId: nextConversation.sessionId,
      messages: await this.getMessagesForSession(nextSession),
      conversations: this.listConversationHistory(mindId),
    };
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
    const selection = this.normalizeModelSelection(model);
    const selectedModel = selection?.id;
    const selectedModelProvider = selection?.provider;

    if (selectedModelProvider === 'byo') {
      this.resolveProviderForSelection(selectedModelProvider);
    }

    if (!context) {
      const existingRecord = this.knownMindRecords.get(mindId);
      if (!existingRecord) return null;
      this.knownMindRecords.set(mindId, {
        id: existingRecord.id,
        path: existingRecord.path,
        ...(selectedModel ? { selectedModel } : {}),
        ...(selectedModelProvider ? { selectedModelProvider } : {}),
        ...(existingRecord.activeSessionId ? { activeSessionId: existingRecord.activeSessionId } : {}),
        ...(existingRecord.conversations ? { conversations: existingRecord.conversations } : {}),
      });
      this.persistConfig();
      return null;
    }

    if (context.selectedModel === selectedModel && context.selectedModelProvider === selectedModelProvider) {
      return this.toExternalContext(context);
    }

    const previousModel = context.selectedModel;
    const previousProvider = context.selectedModelProvider;

    // Persist intent before applying so stale-recovery on send uses the new model.
    context.selectedModel = selectedModel;
    context.selectedModelProvider = selectedModelProvider;
    this.upsertMindSelectionRecord(mindId, context);
    this.persistConfig();

    // SDK setModel can change model ids within the same provider, but it cannot
    // swap a session between GitHub/Copilot and a custom BYO provider.
    const providerChanged = previousProvider !== selectedModelProvider;
    try {
      if (context.session && selectedModel && !providerChanged) {
        await context.session.setModel(selectedModel);
      } else if (context.session) {
        await this.createNewConversationSession(mindId, context);
      }
    } catch (err) {
      // Stale-session errors trigger a recovery path that re-creates the
      // session with the *new* model, so keep the persisted selection.
      // For all other errors (e.g. unreachable BYO endpoint, bad config),
      // roll back so the recorded selection matches the live session —
      // otherwise the next send would use a model the SDK already rejected.
      if (!isStaleSessionError(err)) {
        context.selectedModel = previousModel;
        context.selectedModelProvider = previousProvider;
        this.upsertMindSelectionRecord(mindId, context);
        this.persistConfig();
      }
      throw err;
    }

    this.upsertMindSelectionRecord(mindId, context);
    this.persistConfig();

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
      ...existingConfig,
      version: 2,
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
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

  /**
   * Recreate only sessions that can be affected by a BYO provider change.
   * Enabling/updating BYO does not force cloud-selected minds onto the custom
   * endpoint; disabling BYO clears only BYO-selected minds before reload.
   */
  async restartAllMindsForByoChange(selectedModelOverride?: string | null): Promise<{ restartedCount: number }> {
    await this.awaitRestore();
    const mindIds = selectedModelOverride === null
      ? this.clearByoSelectedModels()
      : this.getLoadedByoMindIds();
    for (const mindId of mindIds) {
      if (this.minds.has(mindId)) {
        await this.reloadMind(mindId);
      }
    }
    return { restartedCount: mindIds.length };
  }

  private getLoadedByoMindIds(): string[] {
    return Array.from(this.minds.values())
      .filter((context) => context.selectedModelProvider === 'byo')
      .map((context) => context.mindId);
  }

  private clearByoSelectedModels(): string[] {
    const changedLoadedMindIds: string[] = [];
    for (const context of this.minds.values()) {
      if (context.selectedModelProvider !== 'byo') continue;
      context.selectedModel = undefined;
      context.selectedModelProvider = undefined;
      changedLoadedMindIds.push(context.mindId);
    }

    let changedRecord = false;
    for (const [mindId, record] of this.knownMindRecords.entries()) {
      if (record.selectedModelProvider !== 'byo') continue;
      const next: MindRecord = { ...record };
      delete next.selectedModel;
      delete next.selectedModelProvider;
      this.knownMindRecords.set(mindId, next);
      changedRecord = true;
    }

    if (changedLoadedMindIds.length > 0 || changedRecord) {
      this.persistConfig();
    }
    return changedLoadedMindIds;
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
      selectedModelProvider: ctx.selectedModelProvider,
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

    return this.createSessionForMind({
      kind: 'task',
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      onUserInputRequest,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });
  }

  async createChatroomSession(mindId: string, onPermissionRequest?: PermissionHandler): Promise<CopilotSession> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const sessionTools = this.getSessionTools(mindId, context.mindPath);

    return this.createSessionForMind({
      kind: 'chatroom',
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: sessionTools,
      onPermissionRequest,
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });
  }

  async runIsolatedPrompt(mindId: string, prompt: string): Promise<string> {
    const context = this.minds.get(mindId);
    if (!context) throw new Error(`Mind ${mindId} not found`);

    const refreshedIdentity = this.identityLoader.load(context.mindPath);
    if (refreshedIdentity) {
      context.identity = refreshedIdentity;
    }

    const session = await this.createSessionForMind({
      kind: 'isolated-prompt',
      client: context.client,
      mindPath: context.mindPath,
      systemMessage: context.identity.systemMessage,
      tools: this.getSessionTools(mindId, context.mindPath),
      model: context.selectedModel,
      modelProvider: context.selectedModelProvider,
    });

    try {
      const response = await session.sendAndWait(
        { prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) },
        ISOLATED_PROMPT_TIMEOUT_MS,
      );
      const text = response?.data.content;
      if (typeof text !== 'string') {
        throw new Error('Isolated prompt did not produce an assistant response');
      }
      return text;
    } finally {
      await session.disconnect().catch((error: unknown) => {
        log.warn('Failed to disconnect isolated prompt session:', error);
      });
    }
  }

  private normalizeModelSelection(model: string | null | undefined): ModelSelection | null {
    return parseModelSelectionKey(model);
  }

  private getRestorableModelSelection(
    mindId: string,
    record: MindRecord | undefined,
  ): { selectedModel?: string; selectedModelProvider?: ModelProvider } {
    const selectedModel = record?.selectedModel;
    if (!selectedModel) return {};
    const selectedModelProvider = record.selectedModelProvider;
    if (selectedModelProvider !== 'byo') {
      return { selectedModel, selectedModelProvider };
    }
    if (this.byoProviderConfigProvider()) {
      return { selectedModel, selectedModelProvider };
    }

    log.warn(`Ignoring saved BYO LLM model selection for mind ${mindId} because BYO LLM is disabled or not configured.`);
    if (record) {
      const next = { ...record };
      delete next.selectedModel;
      delete next.selectedModelProvider;
      this.knownMindRecords.set(mindId, next);
    }
    return {};
  }

  private resolveProviderForSelection(modelProvider: ModelProvider | undefined): SdkProviderConfig | null {
    if (modelProvider !== 'byo') return null;
    const provider = this.byoProviderConfigProvider();
    if (!provider) {
      throw new Error('BYO LLM model selected, but BYO LLM is not enabled or configured.');
    }
    return provider;
  }

  private upsertMindSelectionRecord(mindId: string, context: InternalMindContext): void {
    const existingRecord = this.knownMindRecords.get(mindId);
    this.knownMindRecords.set(mindId, {
      id: mindId,
      path: context.mindPath,
      ...(context.selectedModel ? { selectedModel: context.selectedModel } : {}),
      ...(context.selectedModelProvider ? { selectedModelProvider: context.selectedModelProvider } : {}),
      ...(context.activeSessionId ? { activeSessionId: context.activeSessionId } : {}),
      ...(existingRecord?.conversations ? { conversations: existingRecord.conversations } : {}),
    });
  }

  /**
   * Resolve the effective model for the SDK call.
   *
   * When a BYO model is explicitly selected, the SDK requires `model` on
   * createSession/resumeSession and routes inference to the BYO endpoint via
   * the ProviderConfig set on the session.
   *
   * Source: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md#custom-providers
   *   "When using a custom provider, the `model` parameter is **required**."
   */
  private resolveModelForSdk(model: string | undefined, provider: SdkProviderConfig | null): string | undefined {
    if (model && model.trim().length > 0) return model;
    if (!provider) return undefined;
    const fallback = this.byoDefaultModelProvider();
    if (fallback && fallback.trim().length > 0) return fallback;
    return undefined;
  }

  private async createSessionForMind(req: CreateMindSessionRequest): Promise<CopilotSession> {
    const {
      kind,
      client,
      mindPath,
      systemMessage,
      tools,
      onUserInputRequest,
      onPermissionRequest = approveForSessionCompat,
      useSetApproveAllShortcut = false,
      model,
      modelProvider,
      sessionId,
    } = req;
    this.assertCreateSessionPolicy(kind, sessionId);
    const mcpServers = loadMcpServersFromMindPath(mindPath);
    const skillDirectories = this.getMindSkillDirectories(mindPath);
    const chamberMindConfig = loadChamberMindConfig(mindPath);
    const provider = this.resolveProviderForSelection(modelProvider);
    const effectiveModel = this.resolveModelForSdk(model, provider);
    const sessionConfig: SessionConfig = {
      workingDirectory: mindPath,
      configDir: this.getCopilotRuntimeConfigDir(),
      enableConfigDiscovery: false,
      tools,
      systemMessage: {
        mode: 'customize',
        sections: {
          identity: { action: 'replace', content: systemMessage },
          tone: { action: 'remove' },
        },
      },
      onPermissionRequest,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
      ...(chamberMindConfig.excludedTools && chamberMindConfig.excludedTools.length > 0
        ? { excludedTools: chamberMindConfig.excludedTools }
        : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(provider ? { provider } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
    };
    const session = await client.createSession(sessionConfig);

    // Issue #131 checklist 4: stop short-circuiting per-session approval
    // through `setApproveAll`. The handler-driven `approve-for-session`
    // path now owns the auto-approval decision, which lets B5 surface
    // requests in the chat UI without losing chamber's existing safe
    // defaults. The shortcut remains opt-in for legacy callers that
    // still want the server-side flag.
    if (useSetApproveAllShortcut) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }

    return session;
  }

  private async resumeSessionForMind(
    client: CopilotClient,
    kind: MindSessionKind,
    sessionId: string,
    mindPath: string,
    systemMessage: string,
    tools: Tool[],
    onUserInputRequest?: UserInputHandler,
    onPermissionRequest: PermissionHandler = approveForSessionCompat,
    useSetApproveAllShortcut = false,
    model?: string,
    modelProvider?: ModelProvider,
  ): Promise<CopilotSession> {
    this.assertResumeSessionPolicy(kind);
    const mcpServers = loadMcpServersFromMindPath(mindPath);
    const skillDirectories = this.getMindSkillDirectories(mindPath);
    const chamberMindConfig = loadChamberMindConfig(mindPath);
    const provider = this.resolveProviderForSelection(modelProvider);
    const effectiveModel = this.resolveModelForSdk(model, provider);
    const sessionConfig: ResumeSessionConfig = {
      workingDirectory: mindPath,
      configDir: this.getCopilotRuntimeConfigDir(),
      enableConfigDiscovery: false,
      tools,
      systemMessage: {
        mode: 'customize',
        sections: {
          identity: { action: 'replace', content: systemMessage },
          tone: { action: 'remove' },
        },
      },
      onPermissionRequest,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
      ...(chamberMindConfig.excludedTools && chamberMindConfig.excludedTools.length > 0
        ? { excludedTools: chamberMindConfig.excludedTools }
        : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(provider ? { provider } : {}),
      ...(onUserInputRequest ? { onUserInputRequest } : {}),
    };
    const session = await client.resumeSession(sessionId, sessionConfig);
    if (useSetApproveAllShortcut) {
      await session.rpc.permissions.setApproveAll({ enabled: true });
    }
    return session;
  }

  private getMindSkillDirectories(mindPath: string): string[] {
    const skillsDirectory = path.join(mindPath, '.github', 'skills');
    return fs.existsSync(skillsDirectory) ? [skillsDirectory] : [];
  }

  private assertCreateSessionPolicy(kind: MindSessionKind, sessionId: string | undefined): void {
    const policy = MIND_SESSION_POLICIES[kind];
    if (policy.ownsActiveSession && !sessionId) {
      throw new Error(`${kind} sessions must be created with a Chamber session id`);
    }
    if (!policy.ownsActiveSession && sessionId) {
      throw new Error(`${kind} sessions must not reuse Chamber conversation session ids`);
    }
  }

  private assertResumeSessionPolicy(kind: MindSessionKind): void {
    const policy = MIND_SESSION_POLICIES[kind];
    if (!policy.persistsConversation) {
      throw new Error(`${kind} sessions are ephemeral and cannot be resumed`);
    }
  }

  private getCopilotRuntimeConfigDir(): string {
    return path.join(this.configService.getConfigDir(), COPILOT_RUNTIME_CONFIG_DIR);
  }

  private async loadConversationSession(
    client: CopilotClient,
    kind: MindSessionKind,
    mindPath: string,
    systemMessage: string,
    tools: Tool[],
    conversationSessionId: string,
    model?: string,
    modelProvider?: ModelProvider,
  ): Promise<CopilotSession> {
    try {
      return await this.resumeSessionForMind(
        client,
        kind,
        conversationSessionId,
        mindPath,
        systemMessage,
        tools,
        undefined,
        approveForSessionCompat,
        false,
        model,
        modelProvider,
      );
    } catch (error) {
      if (!isStaleSessionError(error)) throw error;
      log.warn(`SDK session ${conversationSessionId} was not found; reattaching by recreating the session under the same id.`);
      return this.createSessionForMind({
        kind,
        client,
        mindPath,
        systemMessage,
        tools,
        model,
        modelProvider,
        sessionId: conversationSessionId,
      });
    }
  }

  private async deleteSdkSession(context: InternalMindContext, sessionId: string): Promise<void> {
    try {
      await context.client.deleteSession(sessionId);
    } catch (error) {
      if (isStaleSessionError(error)) return;
      log.warn(`Failed to delete SDK session ${sessionId}; Chamber history was already updated.`, error);
    }
  }

  private async getMessagesForSession(session: CopilotSession): Promise<ChatMessage[]> {
    const events = await session.getEvents();
    return events.flatMap((event, index) => this.mapSessionEventToChatMessage(event, index));
  }

  private mapSessionEventToChatMessage(event: unknown, index: number): ChatMessage[] {
    if (typeof event !== 'object' || event === null) return [];
    const record = event as Record<string, unknown>;
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data as Record<string, unknown>
      : {};
    const rawContent = this.extractMessageContent(data);
    const content = record.type === 'user.message' && rawContent
      ? stripInjectedCurrentDateTimeContext(rawContent)
      : rawContent;
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
      let unsub: (() => void) | undefined;
      const timeout = setTimeout(() => {
        unsub?.();
        unsub = undefined;
        resolve();
      }, 120_000);
      unsub = context.session?.on('session.idle', () => {
        clearTimeout(timeout);
        unsub?.();
        unsub = undefined;
        resolve();
      });
    });
  }

  private persistConfig(): void {
    if (this.reloading) return;
    const existingConfig = this.configService.load();
    const config: AppConfig = {
      ...existingConfig,
      version: 2,
      minds: this.getPersistedMindRecords(),
      activeMindId: this.getPersistedActiveMindId(),
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
        ...(mind.selectedModelProvider ? { selectedModelProvider: mind.selectedModelProvider } : {}),
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
      hasMessages: false,
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
        hasMessages: false,
      };
  }

  private upsertConversationRecord(mindId: string, conversation: ChamberConversationRecord, replaceSessionId?: string): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    const conversations = record.conversations ?? [];
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: conversation.sessionId,
      conversations: [
        conversation,
        ...conversations.filter((existing) => existing.sessionId !== conversation.sessionId && existing.sessionId !== replaceSessionId),
      ],
    });
  }

  private touchConversationRecord(mindId: string, sessionId: string): void {
    const record = this.knownMindRecords.get(mindId);
    if (!record) return;
    this.knownMindRecords.set(mindId, {
      ...record,
      activeSessionId: sessionId,
    });
  }

  private defaultConversationTitle(conversation: ChamberConversationRecord): string {
    return `Chat · ${new Date(conversation.createdAt).toLocaleString()}`;
  }

  private getActiveConversationRecord(mindId: string): ChamberConversationRecord | undefined {
    const context = this.minds.get(mindId);
    const activeSessionId = context?.activeSessionId ?? this.knownMindRecords.get(mindId)?.activeSessionId;
    return this.knownMindRecords.get(mindId)?.conversations?.find((conversation) => conversation.sessionId === activeSessionId);
  }

  private conversationTitleFromPrompt(prompt: string): string {
    const firstLine = prompt.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? 'New chat';
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
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
