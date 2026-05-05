import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell, Notification, type MessageBoxOptions, type NativeImage, type Tray as ElectronTray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import started from 'electron-squirrel-startup';

import {
  A2aToolProvider,
  AgentCardRegistry,
  ApprovalGate,
  AuthService,
  CanvasService,
  ChatroomService,
  ChatService,
  ConfigService,
  CopilotClientFactory,
  DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE,
  GenesisMindTemplateInstaller,
  GenesisMindTemplateMarketplaceCatalog,
  GitHubRegistryClient,
  CronService,
  IdentityLoader,
  MessageRouter,
  MarketplaceRegistryService,
  MindManager,
  MindScaffold,
  TaskManager,
  TurnQueue,
  ViewDiscovery,
  configureSdkRuntimeLayout,
  type AppPaths,
  type CredentialStore,
  type GenesisMindTemplateMarketplaceSource,
  type Notifier,
} from '@chamber/services';
import { Logger } from '@chamber/services';
import { createAppTray, loadAppIcon } from './main/tray/Tray';
import { installContextMenu } from './main/contextMenu/ContextMenu';

const log = Logger.create('main');
import { enrollMarketplaceFromProtocolUrl, findMarketplaceInstallUrl, parseMarketplaceInstallUrl } from './main/protocol/marketplaceProtocol';

// IPC adapters
import { setupChatIPC } from './main/ipc/chat';
import { setupMindIPC } from './main/ipc/mind';
import { setupLensIPC } from './main/ipc/lens';
import { setupGenesisIPC } from './main/ipc/genesis';
import { setupMarketplaceIPC } from './main/ipc/marketplace';
import { setupAuthIPC } from './main/ipc/auth';
import { setupA2AIPC } from './main/ipc/a2a';
import { setupChatroomIPC } from './main/ipc/chatroom';
import { setupUpdaterIPC } from './main/ipc/updater';

import { EventEmitter } from 'events';
import { wireLifecycleEvents } from './main/wireLifecycleEvents';
import { cleanupLegacySquirrelInstall } from './main/squirrelMigration';
import { runUpdaterSmoke } from './main/updaterSmoke';
import { UpdaterService } from './main/updater/UpdaterService';

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

const clientFactory = new CopilotClientFactory();
const identityLoader = new IdentityLoader();
const configService = new ConfigService();
const getGenesisMarketplaceSources = (): GenesisMindTemplateMarketplaceSource[] =>
  configService.load().marketplaceRegistries ?? [DEFAULT_GENESIS_MIND_TEMPLATE_SOURCE];
const saveActiveLogin = (login: string | null) => {
  const config = configService.load();
  configService.save({ ...config, activeLogin: login });
};
const credentialStore = loadKeytar();
const githubRegistryClient = GitHubRegistryClient.withCredentialStore(credentialStore);
const authService = new AuthService(
  credentialStore,
  () => configService.load().activeLogin,
  saveActiveLogin,
  `Chamber/${app.getVersion()}`,
);
const scaffold = new MindScaffold();
const genesisTemplateCatalog = new GenesisMindTemplateMarketplaceCatalog(githubRegistryClient, getGenesisMarketplaceSources);
const genesisTemplateInstaller = new GenesisMindTemplateInstaller(githubRegistryClient, clientFactory, getGenesisMarketplaceSources);
const marketplaceRegistryService = new MarketplaceRegistryService(configService, githubRegistryClient);
const viewDiscovery = new ViewDiscovery();

// --- Services (business rules, all dependencies injected) ---

const a2aEventBus = new EventEmitter();
const agentCardRegistry = new AgentCardRegistry();
const turnQueue = new TurnQueue();
const mindManager: MindManager = new MindManager(clientFactory, identityLoader, configService, viewDiscovery);
const taskManager = new TaskManager(mindManager, agentCardRegistry);
const chatService: ChatService = new ChatService(mindManager, turnQueue);
const messageRouter: MessageRouter = new MessageRouter(chatService, agentCardRegistry, a2aEventBus);
const chatroomApprovalGate = new ApprovalGate();
chatroomApprovalGate.setApprovalHandler(async (request) => ({
  correlationId: request.correlationId,
  approved: false,
  decidedBy: 'system',
  timestamp: Date.now(),
  reason: 'Chatroom approval UI is not wired yet; side-effect tools are blocked.',
}));
const chatroomService = new ChatroomService(mindManager, appPaths, chatroomApprovalGate);
const canvasService = new CanvasService({ openExternal: { open: (url) => shell.openExternal(url) } });
const cronService = new CronService({
  getTaskManager: () => taskManager,
  showMind: (mindId) => {
    mindManager.setActiveMind(mindId);
    showMainWindow();
  },
  notifier,
});
const a2aToolProvider = new A2aToolProvider(messageRouter, agentCardRegistry, taskManager);

mindManager.setProviders([cronService, canvasService, a2aToolProvider]);

wireLifecycleEvents({ mindManager, agentCardRegistry, taskManager, a2aEventBus });

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
      return stopMvpServer();
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
      CHAMBER_SERVER_TOKEN: tokenValue,
      CHAMBER_ALLOWED_ORIGIN: 'http://127.0.0.1',
    },
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for MVP server readiness')), 10_000);
    serverChild?.stdout.on('data', (chunk) => {
      for (const line of String(chunk).trim().split(/\r?\n/)) {
        if (!line) continue;
        const payload = JSON.parse(line) as { type?: string; host?: string; port?: number };
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

  // --- IPC adapters (thin, parameter-injected) ---
  setupChatIPC(chatService, mindManager);
  setupMindIPC(mindManager, {
    preloadPath: path.join(__dirname, 'preload.js'),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    rendererPath: MAIN_WINDOW_VITE_DEV_SERVER_URL ? undefined : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    windowIcon,
  });
  setupLensIPC(viewDiscovery, mindManager);
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
  setupMarketplaceIPC(marketplaceRegistryService);
  setupAuthIPC(authService, mindManager);
  setupA2AIPC(a2aEventBus, agentCardRegistry, taskManager);
  setupChatroomIPC(chatroomService);
  setupUpdaterIPC(updaterService);

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('desktop:getBranding', () => ({ name: app.getName(), version: app.getVersion() }));
  ipcMain.handle('desktop:confirm', (_event, message: string) => {
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

  // Restore minds async — awaitRestore() lets IPC handlers wait for completion
  mindManager.restoreFromConfig().catch((err: unknown) => {
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
