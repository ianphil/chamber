import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Services
import { CopilotClientFactory } from './main/services/sdk/CopilotClientFactory';
import { IdentityLoader } from './main/services/chat';
import { ExtensionLoader } from './main/services/extensions';
import { ConfigService } from './main/services/config';
import { AuthService } from './main/services/auth';
import { MindScaffold } from './main/services/genesis';
import { ViewDiscovery } from './main/services/lens';
import { MindManager } from './main/services/mind';
import { ChatService } from './main/services/chat/ChatService';
import { TurnQueue } from './main/services/chat/TurnQueue';
import { AgentCardRegistry, MessageRouter, TaskManager, buildSessionTools } from './main/services/a2a';
import { ChatroomService } from './main/services/chatroom';
import { loadCanvasExtension } from './main/services/extensions/adapters/canvas';
import { loadCronExtension } from './main/services/extensions/adapters/cron';
import { loadIdeaExtension } from './main/services/extensions/adapters/idea';

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

// --- Infrastructure (no business logic, creates capabilities) ---

const clientFactory = new CopilotClientFactory();
const identityLoader = new IdentityLoader();
const extensionLoader = new ExtensionLoader();
extensionLoader.registerAdapter('canvas', loadCanvasExtension);
extensionLoader.registerAdapter('cron', loadCronExtension);
extensionLoader.registerAdapter('idea', loadIdeaExtension);
const configService = new ConfigService();
const authService = new AuthService();
const scaffold = new MindScaffold();
const viewDiscovery = new ViewDiscovery();

// --- Services (business rules, all dependencies injected) ---

const a2aEventBus = new EventEmitter();
const agentCardRegistry = new AgentCardRegistry();
const turnQueue = new TurnQueue();

// ToolBuilder callback — closes over services created below
// Uses late-bound taskManager reference to break circular dependency
// eslint-disable-next-line prefer-const
let taskManager: TaskManager;
const toolBuilder = (mindId: string, extensionTools: unknown[]) =>
  buildSessionTools(mindId, extensionTools as any, messageRouter, agentCardRegistry, taskManager);

const mindManager = new MindManager(clientFactory, identityLoader, extensionLoader, configService, viewDiscovery, toolBuilder);
taskManager = new TaskManager(mindManager, agentCardRegistry);
const chatService = new ChatService(mindManager, turnQueue);
const messageRouter = new MessageRouter(chatService, agentCardRegistry, a2aEventBus);
const chatroomService = new ChatroomService(mindManager);

wireLifecycleEvents({ mindManager, agentCardRegistry, taskManager, a2aEventBus });

// Wire Lens refresh to use the mind's session
viewDiscovery.setRefreshHandler({
  sendBackgroundPrompt: (path, prompt) => mindManager.sendBackgroundPrompt(path, prompt),
});

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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

  // When main window closes, close all popout windows too
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const win of BrowserWindow.getAllWindows()) {
      win.close();
    }
  });
};

app.on('ready', async () => {
  // --- IPC adapters (thin, parameter-injected) ---
  setupChatIPC(chatService, mindManager);
  setupMindIPC(mindManager, {
    preloadPath: path.join(__dirname, 'preload.js'),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
    rendererPath: MAIN_WINDOW_VITE_DEV_SERVER_URL ? undefined : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  });
  setupLensIPC(viewDiscovery, mindManager);
  setupGenesisIPC(mindManager, scaffold);
  setupAuthIPC(authService);
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

  // Restore minds async — awaitRestore() lets IPC handlers wait for completion
  mindManager.restoreFromConfig().catch((err) => {
    console.error('[main] Failed to restore minds:', err);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', (e) => {
  if (isQuitting) return;
  e.preventDefault();
  isQuitting = true;

  mindManager.shutdown()
    .catch(() => {})
    .finally(() => app.quit());
});

