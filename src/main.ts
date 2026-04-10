import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import * as fs from 'fs';
import started from 'electron-squirrel-startup';
import { ChatService } from './main/services/ChatService';
import { ExtensionLoader } from './main/services/ExtensionLoader';
import { ConfigService } from './main/services/ConfigService';
import { AuthService } from './main/services/AuthService';
import { MindScaffold } from './main/services/MindScaffold';
import { IdentityLoader } from './main/services/IdentityLoader';
import { loadCanvasExtension } from './main/services/adapters/canvas';
import { loadCronExtension } from './main/services/adapters/cron';
import { loadIdeaExtension } from './main/services/adapters/idea';
import { setupChatIPC } from './main/ipc/chat';
import { setupAgentIPC } from './main/ipc/agent';
import { setupLensIPC } from './main/ipc/lens';
import { setupGenesisIPC } from './main/ipc/genesis';
import { setupAuthIPC } from './main/ipc/auth';
import { stopSharedClient } from './main/services/SdkLoader';
import { ViewDiscovery } from './main/services/ViewDiscovery';

if (started) {
  app.quit();
}

const identityLoader = new IdentityLoader();
const chatService = new ChatService(identityLoader);
const extensionLoader = new ExtensionLoader();
const viewDiscovery = new ViewDiscovery(chatService);
const configService = new ConfigService();
const authService = new AuthService();
const scaffold = new MindScaffold();
extensionLoader.registerAdapter('canvas', loadCanvasExtension);
extensionLoader.registerAdapter('cron', loadCronExtension);
extensionLoader.registerAdapter('idea', loadIdeaExtension);
chatService.setExtensionLoader(extensionLoader);
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
      sandbox: false, // Required for copilot-sdk IPC
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open DevTools in dev mode
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  }
};

app.on('ready', () => {
  // Restore persisted mind path on startup
  const config = configService.load();
  if (config.mindPath && fs.existsSync(config.mindPath)) {
    chatService.setMindPath(config.mindPath);
    viewDiscovery.scan(config.mindPath).then(() => {
      viewDiscovery.startWatching(() => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('lens:viewsChanged', viewDiscovery.getViews());
      });
    });
  }

  setupChatIPC(chatService);
  setupAgentIPC(chatService, viewDiscovery, configService);
  setupLensIPC(viewDiscovery);
  setupGenesisIPC(chatService, viewDiscovery, configService, scaffold);
  setupAuthIPC(authService);

  // Window control IPC — registered once, not per-window
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  createWindow();
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

  Promise.all([
    chatService.stop(),
    stopSharedClient(),
  ])
    .catch(() => {})
    .finally(() => app.quit());
});

