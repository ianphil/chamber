import { app, BrowserWindow, ipcMain, powerMonitor, type NativeImage, type Tray as ElectronTray } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Services
import { CopilotClientFactory } from './main/services/sdk/CopilotClientFactory';
import { IdentityLoader } from './main/services/chat';
import { ConfigService } from './main/services/config';
import { AuthService } from './main/services/auth';
import { MindScaffold } from './main/services/genesis';
import { ViewDiscovery } from './main/services/lens';
import { MindManager } from './main/services/mind';
import { ChatService } from './main/services/chat/ChatService';
import { TurnQueue } from './main/services/chat/TurnQueue';
import { A2aToolProvider, AgentCardRegistry, MessageRouter, TaskManager } from './main/services/a2a';
import { ChatroomService } from './main/services/chatroom';
import { CronService } from './main/services/cron';
import { createAppTray, loadAppIcon } from './main/tray/Tray';

// IPC adapters
import { setupChatIPC } from './main/ipc/chat';
import { setupMindIPC } from './main/ipc/mind';
import { setupLensIPC } from './main/ipc/lens';
import { setupGenesisIPC } from './main/ipc/genesis';
import { setupAuthIPC } from './main/ipc/auth';
import { setupA2AIPC } from './main/ipc/a2a';
import { setupChatroomIPC } from './main/ipc/chatroom';

import { EventEmitter } from 'events';
import { wireLifecycleEvents } from './main/wireLifecycleEvents';

if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// --- Infrastructure (no business logic, creates capabilities) ---

const clientFactory = new CopilotClientFactory();
const identityLoader = new IdentityLoader();
const configService = new ConfigService();
const saveActiveLogin = (login: string | null) => {
  const config = configService.load();
  configService.save({ ...config, activeLogin: login });
};
const authService = new AuthService(
  undefined,
  () => configService.load().activeLogin,
  saveActiveLogin,
);
const scaffold = new MindScaffold();
const viewDiscovery = new ViewDiscovery();

// --- Services (business rules, all dependencies injected) ---

const a2aEventBus = new EventEmitter();
const agentCardRegistry = new AgentCardRegistry();
const turnQueue = new TurnQueue();
const mindManager: MindManager = new MindManager(clientFactory, identityLoader, configService, viewDiscovery);
const taskManager = new TaskManager(mindManager, agentCardRegistry);
const chatService: ChatService = new ChatService(mindManager, turnQueue);
const messageRouter: MessageRouter = new MessageRouter(chatService, agentCardRegistry, a2aEventBus);
const chatroomService = new ChatroomService(mindManager);
const cronService = new CronService({
  getTaskManager: () => taskManager,
  showMind: (mindId) => {
    mindManager.setActiveMind(mindId);
    showMainWindow();
  },
});
const a2aToolProvider = new A2aToolProvider(messageRouter, agentCardRegistry, taskManager);

mindManager.setProviders([cronService, a2aToolProvider]);

wireLifecycleEvents({ mindManager, agentCardRegistry, taskManager, a2aEventBus });

// Wire Lens refresh to use the mind's session
viewDiscovery.setRefreshHandler({
  sendBackgroundPrompt: (path, prompt) => mindManager.sendBackgroundPrompt(path, prompt),
});

let mainWindow: BrowserWindow | null = null;
let appTray: ElectronTray | null = null;
let windowIcon: NativeImage | undefined;
let isQuitting = false;
const shouldMinimizeToTray = process.platform === 'win32';

const requestQuit = () => {
  if (isQuitting) return;
  isQuitting = true;

  mindManager.shutdown()
    .catch(() => { /* noop */ })
    .finally(() => app.quit());
};

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
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
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
  windowIcon = await loadAppIcon();

  // --- IPC adapters (thin, parameter-injected) ---
  setupChatIPC(chatService, mindManager);
  setupMindIPC(mindManager, {
    preloadPath: path.join(__dirname, 'preload.js'),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    rendererPath: MAIN_WINDOW_VITE_DEV_SERVER_URL ? undefined : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    windowIcon,
  });
  setupLensIPC(viewDiscovery, mindManager);
  setupGenesisIPC(mindManager, scaffold);
  setupAuthIPC(authService, mindManager);
  setupA2AIPC(a2aEventBus, agentCardRegistry, taskManager);
  setupChatroomIPC(chatroomService);

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Create window first (don't block on restore)
  createWindow();
  if (shouldMinimizeToTray) {
    appTray = createAppTray({
      showMainWindow,
      quit: requestQuit,
    }, windowIcon);
  }
  powerMonitor.on('resume', () => {
    void cronService.handlePowerResume();
  });

  // Restore minds async — awaitRestore() lets IPC handlers wait for completion
  mindManager.restoreFromConfig().catch((err: unknown) => {
    console.error('[main] Failed to restore minds:', err);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!shouldMinimizeToTray || isQuitting)) {
    app.quit();
  }
});

app.on('second-instance', () => {
  showMainWindow();
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
