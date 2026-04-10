// Auth IPC handlers
import { ipcMain, BrowserWindow, shell } from 'electron';
import { AuthService } from '../services/auth';

export function setupAuthIPC(authService: AuthService): void {

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
