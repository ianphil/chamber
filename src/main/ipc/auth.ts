// Auth IPC handlers
import { ipcMain, BrowserWindow, shell } from 'electron';
import { AuthService } from '../services/AuthService';

export function setupAuthIPC(): void {
  const authService = new AuthService();

  ipcMain.handle('auth:getStatus', async () => {
    const cred = await authService.getStoredCredential();
    return {
      authenticated: cred !== null,
      login: cred?.login,
    };
  });

  ipcMain.handle('auth:startLogin', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    authService.setProgressHandler((progress) => {
      if (win) {
        win.webContents.send('auth:progress', progress);
      }
      if (progress.step === 'device_code' && progress.verificationUri) {
        shell.openExternal(progress.verificationUri);
      }
    });

    return authService.startLogin();
  });
}
