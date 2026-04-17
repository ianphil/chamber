// Auth IPC adapter — bridges ipcMain to the Dispatcher.
// auth:startLogin is electron-only (uses shell.openExternal); WS callers
// get -32601. The broadcast channels (auth:loggedOut / switched / etc.)
// fan out through the PushBus so every transport sees them.
import { ipcMain, BrowserWindow, shell } from 'electron';
import { AuthService } from '../services/auth';
import type { MindManager } from '../services/mind';
import type { Dispatcher } from '../rpc/dispatcher';
import type { PushBus } from '../rpc/pushBus';
import { makeIpcBridge } from './bridge';
import {
  AuthGetStatusArgs,
  AuthListAccountsArgs,
  AuthLogoutArgs,
  AuthStartLoginArgs,
  AuthSwitchAccountArgs,
} from '../../contracts/auth';

const AUTH_CHANNELS = [
  'auth:getStatus',
  'auth:listAccounts',
  'auth:startLogin',
  'auth:switchAccount',
  'auth:logout',
] as const;

export function setupAuthIPC(
  dispatcher: Dispatcher,
  pushBus: PushBus,
  authService: AuthService,
  mindManager: MindManager,
): void {
  dispatcher.register('auth:getStatus', AuthGetStatusArgs, async () => {
    const cred = await authService.getStoredCredential();
    return { authenticated: cred !== null, login: cred?.login };
  });

  dispatcher.register('auth:listAccounts', AuthListAccountsArgs, async () =>
    authService.listAccounts(),
  );

  dispatcher.register('auth:startLogin', AuthStartLoginArgs, async (_args, ctx) => {
    const sender = ctx.senderHandle as Electron.WebContents;
    const win = BrowserWindow.fromWebContents(sender);
    authService.setProgressHandler((progress) => {
      // Progress is caller-scoped by the legacy contract — only the
      // window that initiated login gets the device-code URL.
      if (win && !win.isDestroyed()) {
        ctx.reply.emit('auth:progress', progress);
      }
      if (progress.step === 'device_code' && progress.verificationUri) {
        shell.openExternal(progress.verificationUri);
      }
    });

    const result = await authService.startLogin();
    if (result.success && result.login) {
      authService.setActiveLogin(result.login);
      pushBus.publish('auth:accountSwitchStarted', { login: result.login });
      try {
        await mindManager.reloadAllMinds();
      } catch (err) {
        console.error('[Auth] Failed to reload minds after login:', err);
      }
      pushBus.publish('auth:accountSwitched', { login: result.login });
    }
    return result;
  });

  dispatcher.register('auth:switchAccount', AuthSwitchAccountArgs, async ([login]) => {
    const accounts = await authService.listAccounts();
    if (!accounts.some((account) => account.login === login)) {
      throw new Error(`Account ${login} is not available`);
    }
    authService.setActiveLogin(login);
    pushBus.publish('auth:accountSwitchStarted', { login });
    try {
      await mindManager.reloadAllMinds();
    } catch (err) {
      console.error('[Auth] Failed to reload minds after account switch:', err);
    }
    pushBus.publish('auth:accountSwitched', { login });
  });

  dispatcher.register('auth:logout', AuthLogoutArgs, async () => {
    await authService.logout();
    pushBus.publish('auth:loggedOut', {});
  });

  for (const channel of AUTH_CHANNELS) {
    ipcMain.handle(channel, makeIpcBridge(dispatcher, channel));
  }
}
