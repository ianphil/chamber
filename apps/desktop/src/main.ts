import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell, Notification, type MessageBoxOptions, type NativeImage, type Tray as ElectronTray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import started from 'electron-squirrel-startup';
import { IPC } from '@chamber/shared';

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
  ChildProcessRunner,
  ToolInstaller,
  ToolsService,
  TurnQueue,
  UserProfileService,
  ViewDiscovery,
  ByoLlmStore,
  buildProviderConfig,
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
import { setupAuthIPC } from './main/ipc/auth';
import { setupByoLlmIPC, probeEndpoint } from './main/ipc/byoLlm';
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

const chamberToolsBinDir = getChamberToolsBinDir();
const clientFactory = new CopilotClientFactory({ toolsBinDir: chamberToolsBinDir });
const configService = new ConfigService();
const identityLoader = new IdentityLoader(() => configService.load().installedTools ?? []);
const getGenesisMarketplaceSources = (): GenesisMindTemplateMarketplaceSource[] =>
  configService.load().marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE];
const saveActiveLogin = (login: string | null) => {
  const config = configService.load();
  configService.save({ ...config, activeLogin: login });
};
const credentialStore = loadKeytar();
const sharp = loadSharp();
const userAgent = `Chamber/${app.getVersion()}`;
const githubRegistryClient = GitHubRegistryClient.withCredentialStore(credentialStore, userAgent);
const authService = new AuthService(
  credentialStore,
  () => configService.load().activeLogin,
  saveActiveLogin,
  userAgent,
);
const scaffold = new MindScaffold();
const genesisTemplateCatalog = new GenesisMindTemplateMarketplaceCatalog(githubRegistryClient, getGenesisMarketplaceSources);
const genesisTemplateInstaller = new GenesisMindTemplateInstaller(githubRegistryClient, clientFactory, getGenesisMarketplaceSources);
const marketplaceRegistryService = new MarketplaceRegistryService(configService, githubRegistryClient);
const marketplaceToolCatalog = new MarketplaceToolCatalog(githubRegistryClient, getGenesisMarketplaceSources);
const toolsService = new ToolsService(
  marketplaceToolCatalog,
  new ToolInstaller(
    new ChildProcessRunner(),
    GitHubReleaseAssetClient.withCredentialStore(credentialStore, userAgent),
    chamberToolsBinDir,
  ),
  configService,
);
const viewDiscovery = new ViewDiscovery();

// --- Services (business rules, all dependencies injected) ---

const a2aEventBus = new EventEmitter();
const agentCardRegistry = new AgentCardRegistry();
const activeA2AResolver = new ActiveA2AResolver(agentCardRegistry);
const turnQueue = new TurnQueue();
const byoLlmStore = new ByoLlmStore({ storeDir: process.env.CHAMBER_E2E_USER_DATA, credentials: credentialStore });
let cachedByoLlmConfig: import('@chamber/shared/types').ByoLlmConfig | null = null;
async function refreshCachedByoLlmConfig(): Promise<void> {
  cachedByoLlmConfig = await byoLlmStore.load();
}
const mindManager: MindManager = new MindManager(
  clientFactory,
  identityLoader,
  configService,
  viewDiscovery,
  () => buildProviderConfig(cachedByoLlmConfig),
  () => cachedByoLlmConfig?.model,
);
const mindProfileService = new MindProfileService({
  getMindPath: (mindId) => mindManager.getMind(mindId)?.mindPath ?? null,
  restartMind: (mindId) => mindManager.reloadMind(mindId),
}, identityLoader, new SharpAvatarNormalizer(sharp));
const userProfileService = new UserProfileService(configService);
const microsoftGraphProfileImporter = new MicrosoftGraphProfileImporter(
  userProfileService,
  new MsalBrokerGraphTokenProvider({
    authDataDir: path.join(appPaths.userData, 'auth', 'microsoft'),
    openBrowser: (url) => shell.openExternal(url),
    clientId: process.env.CHAMBER_MICROSOFT_GRAPH_CLIENT_ID,
    tenantId: process.env.CHAMBER_MICROSOFT_GRAPH_TENANT_ID,
  }),
);
const taskManager = new TaskManager(mindManager, agentCardRegistry);
// BYO LLM models provider — when BYO is enabled, fetch the endpoint's model list
// so it can be merged into the chat model picker alongside the SDK's Copilot models.
// The SDK's `client.listModels()` always returns GitHub Copilot's official catalog
// even when SessionConfig.provider is active, so this side-channel is required.
const byoLlmModelsProvider = async (): Promise<import('@chamber/shared/types').ModelInfo[] | null> => {
  const config = cachedByoLlmConfig;
  if (!config?.enabled || !config.baseUrl) return null;
  try {
    const result = await probeEndpoint(config);
    if (!result.ok || !result.models) return null;
    return result.models.map((m) => ({ id: m.id, name: m.name ?? m.id, provider: 'byo' as const }));
  } catch (err) {
    log.warn('BYO LLM models provider probe failed:', err);
    return null;
  }
};
const chatService: ChatService = new ChatService(mindManager, turnQueue, undefined, byoLlmModelsProvider);
const messageRouter: MessageRouter = new MessageRouter(chatService, activeA2AResolver, a2aEventBus);
const a2aRelayModeService = new A2ARelayModeService(agentCardRegistry, activeA2AResolver, undefined, messageRouter);
const chatroomApprovalGate = new ApprovalGate();
chatroomApprovalGate.setApprovalHandler(async (request) => ({
  correlationId: request.correlationId,
  approved: false,
  decidedBy: 'system',
  timestamp: Date.now(),
  reason: 'Chatroom approval UI is not wired yet; side-effect tools are blocked.',
}));
const chatroomService = new ChatroomService(mindManager, appPaths, chatroomApprovalGate);
const canvasService = new CanvasService({
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
const cronService = new CronService({
  getTaskManager: () => taskManager,
  showMind: (mindId) => {
    mindManager.setActiveMind(mindId);
    showMainWindow();
  },
  notifier,
});
const a2aToolProvider = new A2aToolProvider(messageRouter, activeA2AResolver, taskManager);

const mindToolProviders: ChamberToolProvider[] = [cronService, canvasService, a2aToolProvider];
let chamberCopilotService: ChamberCopilotService | null = null;

if (configService.load().chamberCopilotEnabled === true) {
  const { defaultAcpConnectionFactory, AcpConnection, JobStore, createAcpTools, YOLO_ACP_ARGS } = loadChamberCopilot();
  // SECURITY/CORRECTNESS:
  // - command: pin to the bundled @github/copilot CLI exactly the way
  //   CopilotClientFactory does, so Chamber has a SINGLE source of truth
  //   for "where the bundled CLI lives" across both the SDK runtime and
  //   the chamber-copilot ACP path. chamber-copilot >= 0.5.x ships its
  //   own resolveBundledCopilotBinary helper, but we deliberately reuse
  //   getPlatformCopilotBinaryPath / resolveNodeModulesDir to avoid two
  //   different resolvers drifting against each other.
  //   chamber-copilot >= 0.5.x also makes `command` REQUIRED at runtime
  //   (defaultAcpConnectionFactory({}) throws), so this pin doubles as
  //   the type-system contract.
  // - args: the safe connection matches chamber-copilot's DEFAULT_ACP_ARGS
  //   (post-0.5.x, after --no-auto-login was dropped). Kept explicit as
  //   defense-in-depth so any future upstream default change cannot
  //   silently disable cached host auth or re-enable auto-update on us.
  // - yolo connection (chamber-copilot >= 0.5.11): a SECOND child worker
  //   started with `--yolo`, equivalent to `--allow-all-tools
  //   --allow-all-paths --allow-all-urls`. Any cli_delegate call carrying
  //   `permission_mode: 'yolo'` routes here and runs without an approval
  //   gate. The mode is per-call, opt-in by the delegating mind, and the
  //   upstream tool description warns the model about the trade-off. We
  //   wire it eagerly so a yolo-failure does not block safe startup
  //   (ChamberCopilotService falls back to safe-only and surfaces
  //   UnsupportedPermissionModeError for any yolo request).
  const cliPath = getPlatformCopilotBinaryPath(resolveNodeModulesDir());
  chamberCopilotService = new ChamberCopilotService({
    connectionsByMode: {
      safe: () => new AcpConnection({
        connectionFactory: defaultAcpConnectionFactory({
          command: cliPath,
          args: ['--acp', '--no-auto-update'],
        }),
      }),
      yolo: () => new AcpConnection({
        connectionFactory: defaultAcpConnectionFactory({
          command: cliPath,
          // Use upstream's frozen YOLO_ACP_ARGS directly so we cannot
          // drift from chamber-copilot's own definition of "yolo".
          args: [...YOLO_ACP_ARGS],
        }),
      }),
    },
    // jobStoreFactory + toolFactory are required, not defaulted, so that
    // ChamberCopilotService.ts has zero value-level imports from
    // chamber-copilot. Otherwise the bundled main.js would emit a
    // top-level require('chamber-copilot') that runs BEFORE the
    // app.isPackaged check in loadChamberCopilot() — producing the
    // "Cannot find module 'chamber-copilot'" error from packaged builds.
    jobStoreFactory: (connections) => new JobStore({ connectionsByMode: connections }),
    toolFactory: (deps) => createAcpTools(deps),
  });
  mindToolProviders.push(chamberCopilotService);
  log.info('chamber-copilot ACP extension enabled (safe + yolo)', { cliPath });
}

mindManager.setProviders(mindToolProviders);

wireLifecycleEvents({ mindManager, agentCardRegistry, a2aRelayModeService, taskManager, a2aEventBus });

// Wire Lens refresh to use the mind's session
viewDiscovery.setRefreshHandler(createLensRefreshHandler((mindPath, prompt) => mindManager.sendBackgroundPrompt(mindPath, prompt)));

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
const updaterService = new UpdaterService({
  currentVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  allowDevUpdates: process.env.CHAMBER_UPDATER_ALLOW_DEV === '1',
  setQuitting: () => {
    isQuitting = true;
  },
});

const requestQuit = () => {
  if (isQuitting) return;
  isQuitting = true;

  mindManager.shutdown()
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

  if (useMvpServer) {
    await startMvpServer();
  }
  // Eagerly start the chamber-copilot ACP connection (when the flag is on)
  // so the cli_* tools are available to the very first mind load.
  // MindManager.doLoadMind calls getSessionTools BEFORE activateProviders;
  // without prewarm the first mind in a fresh process boots without the
  // cli_* tools. prewarm() swallows failures and logs.
  if (chamberCopilotService) {
    await chamberCopilotService.prewarm();
  }

  // --- IPC adapters (thin, parameter-injected) ---
  setupChatIPC(chatService, mindManager);
  setupConversationHistoryIPC(chatService);
  setupMindIPC(mindManager, chatService, {
    preloadPath: path.join(__dirname, 'preload.js'),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    rendererPath: MAIN_WINDOW_VITE_DEV_SERVER_URL ? undefined : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    windowIcon,
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
  );
  setupMarketplaceIPC(marketplaceRegistryService, { onRegistryToolsChanged: reconcileMarketplaceTools });
  setupToolsIPC(toolsService);
  setupAuthIPC(authService, mindManager);
  setupByoLlmIPC(byoLlmStore, mindManager, {
    onConfigChanged: (config) => { cachedByoLlmConfig = config; },
  });
  setupA2AIPC(a2aEventBus, agentCardRegistry, taskManager, {
    relayModeService: a2aRelayModeService,
    configStore: configService,
    credentialStore,
  });
  setupChatroomIPC(chatroomService);
  setupUpdaterIPC(updaterService);

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
  void refreshCachedByoLlmConfig()
    .then(() => mindManager.restoreFromConfig())
    .catch((err: unknown) => {
      log.error('Failed to restore minds:', err);
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
