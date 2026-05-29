import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell, Notification, type MessageBoxOptions, type NativeImage, type Tray as ElectronTray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import started from 'electron-squirrel-startup';
import { DEFAULT_APP_FEATURE_FLAGS, IPC } from '@chamber/shared';
import type { MindContext, StartupProgressEvent } from '@chamber/shared/types';
import type { AppFeatureFlags } from '@chamber/shared/feature-flags';

function broadcastStartupProgress(event: StartupProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.APP.STARTUP_PROGRESS, event);
    }
  }
}

// When Chamber is spawned by a parent that may close its stdio pipes early
// (Playwright/Electron Forge teardown, e2e harnesses), subsequent console
// writes throw EPIPE and crash the main process. Swallow EPIPE on stdout/stderr
// so logging is best-effort once the parent has gone away.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  });
}

import {
  A2aToolProvider,
  A2ARelayModeService,
  ActiveA2AResolver,
  AgentCardRegistry,
  ApprovalGate,
  AuthService,
  CanvasService,
  ChamberCopilotService,
  ChatroomService,
  ChatService,
  ConfigService,
  CopilotClientFactory,
  DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE,
  GenesisMindTemplateInstaller,
  GenesisMindTemplateMarketplaceCatalog,
  GitHubRegistryClient,
  GitHubReleaseAssetClient,
  CronService,
  IdentityLoader,
  MarketplaceToolCatalog,
  MessageRouter,
  MicrosoftGraphProfileImporter,
  MsalBrokerGraphTokenProvider,
  MarketplaceRegistryService,
  MindManager,
  MindProfileService,
  MindScaffold,
  TaskManager,
  TaskLedger,
  ChildProcessRunner,
  ToolInstaller,
  ToolsService,
  TurnQueue,
  UserProfileService,
  ViewDiscovery,
  SQLiteLedgerStore,
  setSqliteDatabase,
  ByoLlmStore,
  buildProviderConfig,
  createByoLlmModelsProvider,
  probeEndpoint,
  redactUrlCredentials,
  configureSdkRuntimeLayout,
  getChamberToolsBinDir,
  getPlatformCopilotBinaryPath,
  resolveNodeModulesDir,
  type AppPaths,
  type ChamberToolProvider,
  type CredentialStore,
  type GenesisMindTemplateMarketplaceSource,
  type Notifier,
} from '@chamber/services';
import { Logger } from '@chamber/services';
import { buildMindMemoryService, type MindMemoryComposition } from './main/services/mindMemory/buildMindMemoryService';
import { createAppTray, loadAppIcon } from './main/tray/Tray';
import { installContextMenu } from './main/contextMenu/ContextMenu';
import { installExternalNavigationGuard } from './main/navigationGuard';
import { installContentSecurityPolicy, installPermissionHandlers } from './main/security/sessionSecurity';

const log = Logger.create('main');
import { enrollMarketplaceFromProtocolUrl, findMarketplaceInstallUrl, parseMarketplaceInstallUrl } from './main/protocol/marketplaceProtocol';

// IPC adapters
import { setupChatIPC } from './main/ipc/chat';
import { setupMindIPC } from './main/ipc/mind';
import { setupMindProfileIPC } from './main/ipc/mindProfile';
import { setupLensIPC } from './main/ipc/lens';
import { setupGenesisIPC } from './main/ipc/genesis';
import { setupMarketplaceIPC } from './main/ipc/marketplace';
import { setupToolsIPC } from './main/ipc/tools';
import { setupTasksIPC } from './main/ipc/tasks';
import { setupAuthIPC } from './main/ipc/auth';
import { setupByoLlmIPC } from './main/ipc/byoLlm';
import { setupA2AIPC } from './main/ipc/a2a';
import { setupChatroomIPC } from './main/ipc/chatroom';
import { setupConversationHistoryIPC } from './main/ipc/conversationHistory';
import { setupUpdaterIPC } from './main/ipc/updater';
import { setupUserProfileIPC } from './main/ipc/userProfile';

import { EventEmitter } from 'events';
import { wireLifecycleEvents } from './main/wireLifecycleEvents';
import { cleanupLegacySquirrelInstall } from './main/squirrelMigration';
import { runUpdaterSmoke } from './main/updaterSmoke';
import { UpdaterService } from './main/updater/UpdaterService';
import { SharpAvatarNormalizer } from './main/services/mindProfile/SharpAvatarNormalizer';
import { DEV_FEATURE_FLAGS } from './main/devFeatureFlags';
import { FeatureFlagService } from './main/services/featureFlags/FeatureFlagService';
import type sharpModule from 'sharp';

if (started) {
  app.quit();
}

if (process.env.CHAMBER_E2E_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CHAMBER_E2E_CDP_PORT);
}
if (process.env.CHAMBER_E2E_USER_DATA) {
  app.setPath('userData', process.env.CHAMBER_E2E_USER_DATA);
}

const hasSingleInstanceLock = process.env.CHAMBER_DISABLE_SINGLE_INSTANCE_LOCK === '1' || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// --- Infrastructure (no business logic, creates capabilities) ---

const runtimeRequire = createRequire(__filename);
const appPaths: AppPaths = {
  userData: app.getPath('userData'),
  logs: app.getPath('logs'),
  cache: path.join(app.getPath('userData'), 'Cache'),
  temp: app.getPath('temp'),
};

configureSdkRuntimeLayout({
  isPackaged: app.isPackaged,
  cwd: process.cwd(),
  resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
});

function loadKeytar(): CredentialStore {
  if (!app.isPackaged) {
    return runtimeRequire('keytar') as CredentialStore;
  }

  return runtimeRequire(path.join(process.resourcesPath, 'keytar', 'lib', 'keytar.js')) as CredentialStore;
}

function loadSharp(): typeof sharpModule {
  if (!app.isPackaged) {
    return runtimeRequire('sharp') as typeof sharpModule;
  }

  return runtimeRequire(path.join(process.resourcesPath, 'sharp-runtime', 'node_modules', 'sharp')) as typeof sharpModule;
}

function loadChamberCopilot(): typeof import('chamber-copilot') {
  if (!app.isPackaged) {
    return runtimeRequire('chamber-copilot') as typeof import('chamber-copilot');
  }

  return runtimeRequire(
    path.join(process.resourcesPath, 'acp-runtime', 'node_modules', 'chamber-copilot'),
  ) as typeof import('chamber-copilot');
}

function loadBetterSqlite3(): typeof import('better-sqlite3') {
  if (!app.isPackaged) {
    return runtimeRequire('better-sqlite3') as typeof import('better-sqlite3');
  }

  return runtimeRequire(
    path.join(process.resourcesPath, 'sqlite-runtime', 'node_modules', 'better-sqlite3'),
  ) as typeof import('better-sqlite3');
}

setSqliteDatabase(loadBetterSqlite3());

const notifier: Notifier = {
  notify: (alert) => {
    const notification = new Notification({
      title: alert.title,
      body: alert.body,
    });
    if (alert.onClick) {
      notification.on('click', alert.onClick);
    }
    notification.show();
  },
};

let appFeatureFlags: AppFeatureFlags = DEFAULT_APP_FEATURE_FLAGS;
// Module-level accessor over the live `appFeatureFlags` binding. Shared by
// `initializeRuntime` (IdentityLoader, MindManager, MindProfileService) and
// the `app.on('ready')` IPC setup (setupMindIPC, setupGenesisIPC). Reading
// the property at call-time tracks future remote-policy reloads that
// re-assign `appFeatureFlags`.
const dreamDaemonFeatureEnabled = (): boolean => appFeatureFlags.dreamDaemon;
let credentialStore: CredentialStore;
let sharp: typeof sharpModule;
let configService: ConfigService;
let scaffold: MindScaffold;
let genesisTemplateCatalog: GenesisMindTemplateMarketplaceCatalog;
let genesisTemplateInstaller: GenesisMindTemplateInstaller;
let marketplaceRegistryService: MarketplaceRegistryService;
let toolsService: ToolsService;
let viewDiscovery: ViewDiscovery;
let a2aEventBus: EventEmitter;
let agentCardRegistry: AgentCardRegistry;
let taskManager: TaskManager;
let byoLlmStore: ByoLlmStore;
let cachedByoLlmConfig: import('@chamber/shared/types').ByoLlmConfig | null = null;
let mindManager: MindManager;
let mindProfileService: MindProfileService;
let userProfileService: UserProfileService;
let microsoftGraphProfileImporter: MicrosoftGraphProfileImporter;
let chatService: ChatService;
let a2aRelayModeService: A2ARelayModeService;
let chatroomService: ChatroomService;
let canvasService: CanvasService;
let cronService: CronService;
let authService: AuthService;
let chamberCopilotService: ChamberCopilotService | null = null;
let updaterService: UpdaterService;
let mindMemoryComposition: MindMemoryComposition | undefined;
let mindMemoryService: MindMemoryComposition['service'] | undefined;
const taskLedgersByMindPath = new Map<string, TaskLedger>();

const createTaskLedger = (mindPath: string): TaskLedger => {
  const existing = taskLedgersByMindPath.get(mindPath);
  if (existing) return existing;
  const ledger = new TaskLedger(
    new SQLiteLedgerStore(path.join(mindPath, '.chamber', 'runs', 'tasks.db')),
  );
  taskLedgersByMindPath.set(mindPath, ledger);
  return ledger;
};

async function initializeRuntime(): Promise<void> {
  const userAgent = `Chamber/${app.getVersion()}`;
  appFeatureFlags = await new FeatureFlagService({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    userDataPath: appPaths.userData,
    devFeatureFlags: DEV_FEATURE_FLAGS,
    previewFeatures: process.env.CHAMBER_E2E === '1' && process.env.CHAMBER_E2E_PREVIEW_FEATURES === '1',
  }).initialize();

  const chamberToolsBinDir = getChamberToolsBinDir();
  const clientFactory = new CopilotClientFactory({ toolsBinDir: chamberToolsBinDir });
  void clientFactory.preloadSdk().catch((err: unknown) => {
    log.warn('SDK preload failed (non-fatal — first createClient will retry):', err);
  });

  configService = new ConfigService();
  const identityLoader = new IdentityLoader(
    () => configService.load().installedTools ?? [],
    undefined,
    dreamDaemonFeatureEnabled,
  );
  const getGenesisMarketplaceSources = (): GenesisMindTemplateMarketplaceSource[] =>
    configService.load().marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE];
  const saveActiveLogin = (login: string | null) => {
    const config = configService.load();
    configService.save({ ...config, activeLogin: login });
  };
  credentialStore = loadKeytar();
  sharp = loadSharp();
  const githubRegistryClient = GitHubRegistryClient.withCredentialStore(credentialStore, userAgent);
  authService = new AuthService(
    credentialStore,
    () => configService.load().activeLogin,
    saveActiveLogin,
    userAgent,
  );
  scaffold = new MindScaffold();
  genesisTemplateCatalog = new GenesisMindTemplateMarketplaceCatalog(githubRegistryClient, getGenesisMarketplaceSources);
  genesisTemplateInstaller = new GenesisMindTemplateInstaller(githubRegistryClient, clientFactory, getGenesisMarketplaceSources);
  marketplaceRegistryService = new MarketplaceRegistryService(configService, githubRegistryClient);
  const marketplaceToolCatalog = new MarketplaceToolCatalog(githubRegistryClient, getGenesisMarketplaceSources);
  toolsService = new ToolsService(
    marketplaceToolCatalog,
    new ToolInstaller(
      new ChildProcessRunner(),
      GitHubReleaseAssetClient.withCredentialStore(credentialStore, userAgent),
      chamberToolsBinDir,
    ),
    configService,
  );
  viewDiscovery = new ViewDiscovery();

  a2aEventBus = new EventEmitter();
  agentCardRegistry = new AgentCardRegistry();
  const activeA2AResolver = new ActiveA2AResolver(agentCardRegistry);
  const turnQueue = new TurnQueue();
  byoLlmStore = new ByoLlmStore({ storeDir: process.env.CHAMBER_E2E_USER_DATA, credentials: credentialStore });
  mindManager = new MindManager(
    clientFactory,
    identityLoader,
    configService,
    viewDiscovery,
    () => buildProviderConfig(cachedByoLlmConfig),
    () => cachedByoLlmConfig?.model,
    dreamDaemonFeatureEnabled,
  );
  mindProfileService = new MindProfileService({
    getMindPath: (mindId) => mindManager.getMind(mindId)?.mindPath ?? null,
    restartMind: (mindId) => mindManager.reloadMind(mindId),
  }, identityLoader, new SharpAvatarNormalizer(sharp), dreamDaemonFeatureEnabled);
  userProfileService = new UserProfileService(configService);
  microsoftGraphProfileImporter = new MicrosoftGraphProfileImporter(
    userProfileService,
    new MsalBrokerGraphTokenProvider({
      authDataDir: path.join(appPaths.userData, 'auth', 'microsoft'),
      openBrowser: (url) => shell.openExternal(url),
      clientId: process.env.CHAMBER_MICROSOFT_GRAPH_CLIENT_ID,
      tenantId: process.env.CHAMBER_MICROSOFT_GRAPH_TENANT_ID,
    }),
  );
  taskManager = new TaskManager(mindManager, agentCardRegistry, {
    getLedgerForMind: (mindId) => {
      const mindPath = mindManager.getMind(mindId)?.mindPath;
      return mindPath ? createTaskLedger(mindPath) : undefined;
    },
  });
  // The SDK model catalog does not include BYO endpoint models, so keep the
  // saved BYO model visible through this side-channel when the flag is enabled.
  const byoLlmModelsProvider = createByoLlmModelsProvider({
    getConfig: () => appFeatureFlags.byoLlm ? cachedByoLlmConfig : null,
    probe: probeEndpoint,
    onProbeError: (err, config) => {
      log.warn(`BYO LLM models provider probe failed (baseUrl=${redactUrlCredentials(config.baseUrl)}):`, err);
    },
  });
  chatService = new ChatService(mindManager, turnQueue, undefined, byoLlmModelsProvider);
  const messageRouter = new MessageRouter(chatService, activeA2AResolver, a2aEventBus);
  a2aRelayModeService = new A2ARelayModeService(agentCardRegistry, activeA2AResolver, undefined, messageRouter);
  const chatroomApprovalGate = new ApprovalGate();
  chatroomApprovalGate.setApprovalHandler(async (request) => ({
    correlationId: request.correlationId,
    approved: false,
    decidedBy: 'system',
    timestamp: Date.now(),
    reason: 'Chatroom approval UI is not wired yet; side-effect tools are blocked.',
  }));
  chatroomService = new ChatroomService(mindManager, appPaths, chatroomApprovalGate);
  canvasService = new CanvasService({
    onAction: (action) => {
      if (!action.lensViewId) {
        log.info('Canvas action received:', action);
        return;
      }
      const mindPath = mindManager.getMind(action.mindId)?.mindPath;
      if (!mindPath) {
        log.warn(`Canvas Lens action for unknown mind: ${action.mindId}`);
        return;
      }
      void viewDiscovery.sendCanvasAction(action.lensViewId, {
        action: action.action,
        data: action.data,
      }, mindPath).catch((error: unknown) => {
        log.warn('Canvas Lens action failed:', error);
      });
    },
    openExternal: { open: (url) => shell.openExternal(url) },
  });
  cronService = new CronService({
    getTaskManager: () => taskManager,
    showMind: (mindId) => {
      mindManager.setActiveMind(mindId);
      showMainWindow();
    },
    notifier,
    createTaskLedger,
  });
  const a2aToolProvider = new A2aToolProvider(messageRouter, activeA2AResolver, taskManager);
  const mindToolProviders: ChamberToolProvider[] = [cronService, canvasService, a2aToolProvider];
  chamberCopilotService = createChamberCopilotService(mindToolProviders, createTaskLedger);
  mindManager.setProviders(mindToolProviders);
  wireLifecycleEvents({ mindManager, agentCardRegistry, a2aRelayModeService, taskManager, a2aEventBus });
  viewDiscovery.setRefreshHandler(createLensRefreshHandler((mindPath, prompt) => mindManager.sendBackgroundPrompt(mindPath, prompt)));

  // -------------------------------------------------------------------------
  // MindMemory (Dream Daemon) — per-mind background memory consolidation.
  // Gated behind the `dreamDaemon` app feature flag. When the flag is off,
  // `mindMemoryComposition` stays undefined and the lifecycle hooks below
  // are never registered, so `mind:loaded` / `mind:unloaded` are no-ops
  // for memory purposes. The composition root owns close() during quit —
  // requestQuit() and before-quit both guard on `mindMemoryComposition?`.
  //
  // Wires after providers so chatService observers + scheduler are ready
  // before any mind:loaded event fires. The better-sqlite3 ctor is injected
  // from the shared `loadBetterSqlite3()` resolver so dev and packaged
  // builds both go through the unified `chamber-sqlite-runtime`.
  // -------------------------------------------------------------------------
  if (appFeatureFlags.dreamDaemon) {
    mindMemoryComposition = buildMindMemoryService({
      mindManager,
      chatService,
      Database: loadBetterSqlite3(),
    });
    mindMemoryService = mindMemoryComposition.service;
    const memoryService = mindMemoryService;
    mindManager.on('mind:loaded', (ctx: MindContext) => {
      memoryService.activateMind(ctx.mindId, ctx.mindPath).catch((err) => {
        log.warn('mindMemory: activateMind failed', { mindId: ctx.mindId, err: String(err) });
      });
    });
    mindManager.on('mind:unloaded', (mindId: string) => {
      memoryService.releaseMind(mindId).catch((err) => {
        log.warn('mindMemory: releaseMind failed', { mindId, err: String(err) });
      });
    });
  }

  updaterService = new UpdaterService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    allowDevUpdates: process.env.CHAMBER_UPDATER_ALLOW_DEV === '1',
    setQuitting: () => {
      isQuitting = true;
    },
  });
}

async function refreshCachedByoLlmConfig(): Promise<void> {
  cachedByoLlmConfig = appFeatureFlags.byoLlm ? await byoLlmStore.load() : null;
}

function createChamberCopilotService(
  mindToolProviders: ChamberToolProvider[],
  createTaskLedger: (mindPath: string) => TaskLedger,
): ChamberCopilotService | null {
  if (!appFeatureFlags.chamberCopilot) return null;
  const { defaultAcpConnectionFactory, AcpConnection, JobStore, createAcpTools } = loadChamberCopilot();
  // Reuse the same bundled Copilot CLI resolver as the SDK runtime so the ACP
  // path cannot drift to a different binary.
  const cliPath = getPlatformCopilotBinaryPath(resolveNodeModulesDir());
  const service = new ChamberCopilotService({
    connectionsByMode: {
      safe: () => new AcpConnection({
        connectionFactory: defaultAcpConnectionFactory({
          command: cliPath,
          args: ['--acp', '--no-auto-update'],
        }),
      }),
    },
    // Keep value-level chamber-copilot imports out of ChamberCopilotService.ts;
    // packaged builds must only require chamber-copilot after loadChamberCopilot().
    jobStoreFactory: (connections) => new JobStore({ connectionsByMode: connections }),
    toolFactory: (deps) => createAcpTools(deps),
    createTaskLedger,
  });
  mindToolProviders.push(service);
  log.info('chamber-copilot ACP extension enabled (safe only)', { cliPath });
  return service;
}

let mainWindow: BrowserWindow | null = null;
let appTray: ElectronTray | null = null;
let windowIcon: NativeImage | undefined;
let isQuitting = false;
let serverChild: ChildProcessWithoutNullStreams | null = null;
let mvpServerUrl: string | null = null;
const launchProtocolUrl = findMarketplaceInstallUrl(process.argv);
const pendingProtocolUrls: string[] = launchProtocolUrl ? [launchProtocolUrl] : [];
const shouldMinimizeToTray = process.platform === 'win32';
const useMvpServer = process.env.CHAMBER_MVP_SERVER === '1';

const requestQuit = () => {
  if (isQuitting) return;
  isQuitting = true;

  // INVARIANT: close MindMemoryService BEFORE MindManager.shutdown so each
  // mind's dream.db handle and scheduler entry tear down while the underlying
  // Mind / SDK client is still alive — avoids cron ticks racing with mind
  // teardown and leaves dream.db files cleanly closed on disk. The optional
  // chain matters because requestQuit() can run before initializeRuntime()
  // has assigned mindMemoryComposition (e.g., updater smoke early-return)
  // and because Phase 3 will gate composition behind the dreamDaemon flag.
  const closeMindMemory = mindMemoryComposition
    ? mindMemoryComposition.close().catch((err) => {
        log.warn('mindMemory: shutdown close failed', { err: String(err) });
      })
    : Promise.resolve();
  closeMindMemory
    .then(() => mindManager.shutdown())
    .then(() => {
      updaterService.stop();
      return Promise.allSettled([a2aRelayModeService.disconnect(), stopMvpServer()]);
    })
    .catch(() => { /* noop */ })
    .finally(() => app.quit());
};

async function startMvpServer(): Promise<string> {
  if (!useMvpServer) return '';
  const serverEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'bin.mjs')
    : path.join(process.cwd(), 'apps', 'server', 'dist', 'bin.mjs');
  const nodePath = process.execPath;
  const tokenValue = process.env.CHAMBER_SERVER_TOKEN ?? randomBytes(32).toString('base64url');

  serverChild = spawn(nodePath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CHAMBER_SERVER_TOKEN: tokenValue,
      CHAMBER_ALLOWED_ORIGIN: 'http://127.0.0.1',
    },
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for MVP server readiness')), 10_000);
    let stdoutBuffer = '';
    serverChild?.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        let payload: { type?: string; host?: string; port?: number };
        try {
          payload = JSON.parse(line) as { type?: string; host?: string; port?: number };
        } catch {
          log.info(line);
          continue;
        }
        if (payload.type === 'ready' && payload.host && payload.port) {
          clearTimeout(timer);
          const url = `http://${payload.host}:${payload.port}`;
          mvpServerUrl = url;
          resolve(url);
        }
      }
    });
    serverChild?.stderr.on('data', (chunk) => log.error(String(chunk)));
    serverChild?.on('exit', (code) => {
      if (!mvpServerUrl) {
        clearTimeout(timer);
        reject(new Error(`MVP server exited before readiness (${code ?? 'unknown'})`));
      }
    });
  });
}

function stopMvpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverChild || serverChild.killed) {
      resolve();
      return;
    }
    const child = serverChild;
    serverChild = null;
    const timer = setTimeout(() => {
      if (!child.killed) child.kill();
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

const showMainWindow = () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
};

const showMarketplaceProtocolMessage = (type: 'info' | 'error', message: string, detail?: string): void => {
  const options: MessageBoxOptions = {
    type,
    buttons: ['OK'],
    message,
    detail,
  };
  if (mainWindow) {
    void dialog.showMessageBox(mainWindow, options);
  } else {
    void dialog.showMessageBox(options);
  }
};

const reconcileMarketplaceTools = (): void => {
  toolsService.reconcile()
    .then((outcome) => {
      if (outcome.installed.length > 0) {
        log.info(`Installed ${outcome.installed.length} new marketplace tool(s):`, outcome.installed.map((tool) => tool.id));
      }
      if (outcome.errors.length > 0) {
        log.warn(`Tool reconcile encountered ${outcome.errors.length} error(s):`, outcome.errors);
      }
    })
    .catch((error: unknown) => log.warn('Tool reconciliation failed:', error));
};

const confirmMarketplaceProtocolEnrollment = async (registryUrl: string): Promise<boolean> => {
  const options: MessageBoxOptions = {
    type: 'question',
    buttons: ['Cancel', 'Add Marketplace'],
    defaultId: 1,
    cancelId: 0,
    message: 'Add this Genesis marketplace to Chamber?',
    detail: registryUrl,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
};

const handleProtocolUrl = (rawUrl: string): void => {
  const installUrl = parseMarketplaceInstallUrl(rawUrl);
  if (!installUrl) return;

  if (!app.isReady()) {
    pendingProtocolUrls.push(rawUrl);
    return;
  }

  showMainWindow();
  confirmMarketplaceProtocolEnrollment(installUrl.registryUrl)
    .then((confirmed) => {
      if (!confirmed) return false;
      return enrollMarketplaceFromProtocolUrl(
        rawUrl,
        (registryUrl) => marketplaceRegistryService.addGenesisRegistry(registryUrl),
        (error) => {
          log.warn('Protocol registry enrollment failed:', error);
          showMarketplaceProtocolMessage('error', 'Unable to add marketplace', error);
        },
      );
    })
    .then((added) => {
      if (added) {
        reconcileMarketplaceTools();
        showMarketplaceProtocolMessage('info', 'Marketplace added to Chamber', installUrl.registryUrl);
      }
    })
    .catch((error: unknown) => {
      log.warn('Protocol registry enrollment failed:', error);
      showMarketplaceProtocolMessage('error', 'Unable to add marketplace', error instanceof Error ? error.message : String(error));
    });
};

const drainPendingProtocolUrls = (): void => {
  for (const rawUrl of pendingProtocolUrls.splice(0)) {
    handleProtocolUrl(rawUrl);
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#09090b',
      symbolColor: '#fafafa',
      height: 36,
    } : undefined,
    icon: windowIcon,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required: copilot-sdk IPC uses Node.js APIs via preload; mitigated by contextIsolation:true + nodeIntegration:false
    },
  });

  installContextMenu(mainWindow.webContents);
  installExternalNavigationGuard(mainWindow.webContents);

  if (mvpServerUrl) {
    mainWindow.loadURL(mvpServerUrl);
  } else if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }

  mainWindow.on('close', (event) => {
    if (!shouldMinimizeToTray || isQuitting) return;

    event.preventDefault();
    for (const win of BrowserWindow.getAllWindows()) {
      win.hide();
    }
  });

  // When main window closes, close all popout windows too
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const win of BrowserWindow.getAllWindows()) {
      win.close();
    }
  });
};

app.on('ready', async () => {
  app.setAsDefaultProtocolClient('chamber');
  windowIcon = await loadAppIcon();
  if (runUpdaterSmoke(app)) {
    return;
  }

  installContentSecurityPolicy(session.defaultSession, app.isPackaged ? 'production' : 'development');
  installPermissionHandlers(session.defaultSession);

  cleanupLegacySquirrelInstall({ isPackaged: app.isPackaged })
    .then((result) => {
      if (result.status !== 'skipped') {
        log.info(`squirrel-migration: ${result.status}`, result);
      }
    })
    .catch((error: unknown) => {
      log.warn('squirrel-migration: Unexpected cleanup failure:', error);
    });

  await initializeRuntime();

  if (useMvpServer) {
    await startMvpServer();
  }
  // Eagerly start the chamber-copilot ACP connection (when the flag is on)
  // so the cli_* tools are available to the very first mind load.
  // MindManager.doLoadMind calls getSessionTools BEFORE activateProviders;
  // without prewarm the first mind in a fresh process boots without the
  // cli_* tools. prewarm() swallows failures and logs.
  //
  // INVARIANT: Do NOT await prewarm here. The child Copilot CLI can hang
  // during ACP handshake (observed in packaged macOS builds where the
  // re-signed CLI exits 1 with no output), and awaiting would block
  // createWindow() below — producing a no-window "black screen" boot.
  // prewarm() is best-effort by design (swallows errors); the first mind
  // load racing prewarm is the acceptable tradeoff for guaranteed UI.
  if (chamberCopilotService) {
    void chamberCopilotService.prewarm();
  }

  // --- IPC adapters (thin, parameter-injected) ---
  setupChatIPC(chatService, mindManager);
  setupConversationHistoryIPC(chatService);
  setupMindIPC(mindManager, chatService, {
    preloadPath: path.join(__dirname, 'preload.js'),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    rendererPath: MAIN_WINDOW_VITE_DEV_SERVER_URL ? undefined : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    windowIcon,
    dreamDaemonEnabled: dreamDaemonFeatureEnabled,
  });
  setupMindProfileIPC(mindProfileService, mindManager, sharp);
  setupUserProfileIPC(userProfileService, microsoftGraphProfileImporter);
  setupLensIPC(viewDiscovery, mindManager, canvasService);
  setupGenesisIPC(
    mindManager,
    scaffold,
    { listTemplates: async () => {
      const result = await genesisTemplateCatalog.listTemplates();
      if (result.templates.length === 0) {
        const errors = result.sources.filter(s => s.status === 'error');
        if (errors.length > 0) {
          throw new Error(errors.map(s => s.message).join('; '));
        }
      }
      return result.templates;
    }},
    genesisTemplateInstaller,
    { dreamDaemonEnabled: dreamDaemonFeatureEnabled },
  );
  setupMarketplaceIPC(marketplaceRegistryService, { onRegistryToolsChanged: reconcileMarketplaceTools });
  setupToolsIPC(toolsService);
  setupTasksIPC({
    getLedgerForMind: (mindId) => {
      const mindPath = mindManager.getMind(mindId)?.mindPath;
      return mindPath ? createTaskLedger(mindPath) : undefined;
    },
  });
  setupAuthIPC(authService, mindManager);
  setupByoLlmIPC(byoLlmStore, mindManager, {
    featureEnabled: appFeatureFlags.byoLlm,
    onConfigChanged: (config) => { cachedByoLlmConfig = appFeatureFlags.byoLlm ? config : null; },
  });
  setupA2AIPC(a2aEventBus, agentCardRegistry, taskManager, {
    relayModeService: a2aRelayModeService,
    configStore: configService,
    credentialStore,
  });
  setupChatroomIPC(chatroomService);
  setupUpdaterIPC(updaterService);

  // Test-only hook: expose the MindMemoryService on globalThis so a Playwright
  // driver attached via `electronApp.evaluate(...)` can drive the Dream Daemon
  // (forceRun, getStatus, dbPath) without us building a renderer-facing bridge
  // and the production type contract that comes with it. Gated by CHAMBER_E2E.
  // After Phase 3 gates the composition behind the dreamDaemon flag, this
  // assignment becomes a no-op (mindMemoryService stays undefined) when the
  // flag is off — exactly what we want for the flag-off E2E smoke.
  if (process.env.CHAMBER_E2E === '1' && mindMemoryService) {
    (globalThis as { __chamberMindMemoryService?: typeof mindMemoryService }).__chamberMindMemoryService =
      mindMemoryService;
  }

  // Fire-and-forget tool reconciliation: install any new marketplace tools.
  // Errors are logged in ToolsService and surface via tools:list later.
  reconcileMarketplaceTools();

  // Window controls
  ipcMain.on(IPC.WINDOW.MINIMIZE, () => mainWindow?.minimize());
  ipcMain.on(IPC.WINDOW.MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on(IPC.WINDOW.CLOSE, () => mainWindow?.close());
  ipcMain.handle(IPC.DESKTOP.GET_BRANDING, () => ({ name: app.getName(), version: app.getVersion() }));
  ipcMain.handle(IPC.APP.GET_FEATURE_FLAGS, () => appFeatureFlags);
  ipcMain.handle(IPC.DESKTOP.CONFIRM, (_event, message: string) => {
    const choice = mainWindow
      ? dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['Cancel', 'OK'],
          defaultId: 1,
          cancelId: 0,
          message,
        })
      : 0;
    return choice === 1;
  });

  // Create window first (don't block on restore)
  createWindow();
  drainPendingProtocolUrls();
  if (shouldMinimizeToTray) {
    appTray = createAppTray({
      showMainWindow,
      quit: requestQuit,
    }, windowIcon);
  }
  powerMonitor.on('resume', () => {
    void cronService.handlePowerResume();
  });
  updaterService.start();

  // Restore minds async — awaitRestore() lets IPC handlers wait for completion.
  //
  // Boot-screen activity log (#56) — broadcast structured progress to the
  // ChamberLoadingScreen so the user sees real work instead of a passive
  // spinner. Subscribe to mind:loaded BEFORE calling restoreFromConfig so we
  // catch the first event the restore loop emits.
  const onMindLoadedForBoot = (mind: MindContext) => {
    broadcastStartupProgress({ kind: 'mind-restored', detail: mind.identity.name });
  };
  mindManager.on('mind:loaded', onMindLoadedForBoot);
  broadcastStartupProgress({ kind: 'restore-start', detail: 'restoring minds from config' });
  void refreshCachedByoLlmConfig()
    .then(() => mindManager.restoreFromConfig())
    .catch((err: unknown) => {
      log.error('Failed to restore minds:', err);
    })
    .finally(() => {
      mindManager.off('mind:loaded', onMindLoadedForBoot);
      const count = mindManager.listMinds().length;
      broadcastStartupProgress({
        kind: 'restore-complete',
        detail: count === 1 ? '1 mind ready' : `${count} minds ready`,
      });
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!shouldMinimizeToTray || isQuitting)) {
    app.quit();
  }
});

app.on('second-instance', (_event, argv) => {
  const rawUrl = findMarketplaceInstallUrl(argv);
  if (rawUrl) {
    handleProtocolUrl(rawUrl);
  }
  showMainWindow();
});

app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  handleProtocolUrl(rawUrl);
  if (app.isReady()) {
    showMainWindow();
  }
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', (e) => {
  if (isQuitting) return;
  e.preventDefault();
  requestQuit();
});

app.on('will-quit', () => {
  appTray?.destroy();
  appTray = null;
});

function createLensRefreshHandler(sendBackgroundPrompt: (mindPath: string, prompt: string) => Promise<void>) {
  const e2eRefreshJson = process.env.CHAMBER_E2E_LENS_REFRESH_JSON;
  if (process.env.CHAMBER_E2E !== '1' || !e2eRefreshJson) {
    return { sendBackgroundPrompt };
  }

  const refreshData = JSON.parse(e2eRefreshJson) as unknown;
  const delayMs = Number(process.env.CHAMBER_E2E_LENS_REFRESH_DELAY_MS ?? 0);
  return {
    sendBackgroundPrompt: async (_mindPath: string, prompt: string) => {
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      fs.writeFileSync(parseLensRefreshOutputPath(prompt), `${JSON.stringify(refreshData, null, 2)}\n`);
    },
  };
}

function parseLensRefreshOutputPath(prompt: string): string {
  const match = /Write the JSON output to:\s*(.+)\s*$/m.exec(prompt);
  if (!match?.[1]) throw new Error('E2E Lens refresh prompt did not include an output path.');
  return match[1].trim();
}
