// Auth IPC handlers
import { ipcMain, BrowserWindow, shell } from 'electron';
import { IPC } from '@chamber/shared';
import { AuthService, Logger, type MindManager } from '@chamber/services';

const log = Logger.create('Auth');

const E2E_ENABLED = process.env.CHAMBER_E2E === '1';

type AuthBroadcastChannel =
  | typeof IPC.AUTH.LOGGED_OUT
  | typeof IPC.AUTH.ACCOUNT_SWITCH_STARTED
  | typeof IPC.AUTH.ACCOUNT_SWITCHED
  | typeof IPC.AUTH.PROGRESS;

function broadcast(
  channel: AuthBroadcastChannel,
  payload?: { login: string } | Record<string, unknown>,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (payload !== undefined) {
      win.webContents.send(channel, payload);
      continue;
    }
    win.webContents.send(channel);
  }
}

export function setupAuthIPC(
  authService: AuthService,
  mindManager: MindManager,
  onAuthStateChanged: () => Promise<void> = async () => undefined,
): void {

  ipcMain.handle(IPC.AUTH.GET_STATUS, async () => {
    const cred = await authService.getStoredCredential();
    return {
      authenticated: cred !== null,
      login: cred?.login,
    };
  });

  ipcMain.handle(IPC.AUTH.LIST_ACCOUNTS, async () => authService.listAccounts());

  // Tracks in-flight login attempts so auth:cancelLogin can abort them.
  // Each call to auth:startLogin gets its own AbortController, isolating
  // progress + abort state per request (#139).
  const inflightLoginControllers = new Set<AbortController>();

  // E2E short-circuit: when CHAMBER_E2E=1, do not hit the real GitHub device flow.
  // Tests drive auth:progress via e2e:auth:emit-progress and resolve startLogin
  // via e2e:auth:complete-login, exercising the full renderer lifecycle without
  // a network roundtrip or external browser launch.
  let e2eStartLoginResolver: ((value: { success: boolean; login?: string }) => void) | null = null;

  const reloadMindsAfterAuthChange = async (context: string): Promise<void> => {
    try {
      await onAuthStateChanged();
    } catch (err) {
      log.error(`Failed to refresh auth-bound services after ${context}:`, err);
    }
    try {
      await mindManager.reloadAllMinds();
    } catch (err) {
      log.error(`Failed to reload minds after ${context}:`, err);
    }
  };

  ipcMain.handle(IPC.AUTH.START_LOGIN, async (event) => {
    if (E2E_ENABLED) {
      // Resolve any prior pending stub before starting a new one.
      if (e2eStartLoginResolver) {
        e2eStartLoginResolver({ success: false });
        e2eStartLoginResolver = null;
      }
      const result = await new Promise<{ success: boolean; login?: string }>((resolve) => {
        e2eStartLoginResolver = resolve;
      });
      if (result.success && result.login) {
        authService.setActiveLogin(result.login);
        broadcast(IPC.AUTH.ACCOUNT_SWITCH_STARTED, { login: result.login });
        await reloadMindsAfterAuthChange('e2e login');
        broadcast(IPC.AUTH.ACCOUNT_SWITCHED, { login: result.login });
      }
      return result;
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const controller = new AbortController();
    inflightLoginControllers.add(controller);

    try {
      const result = await authService.startLogin({
        onProgress: (progress) => {
          if (win) {
            win.webContents.send(IPC.AUTH.PROGRESS, progress);
          }
          if (progress.step === 'device_code' && progress.verificationUri) {
            shell.openExternal(progress.verificationUri);
          }
        },
        signal: controller.signal,
      });
      if (result.success && result.login) {
        authService.setActiveLogin(result.login);
        broadcast(IPC.AUTH.ACCOUNT_SWITCH_STARTED, { login: result.login });
        await reloadMindsAfterAuthChange('login');
        broadcast(IPC.AUTH.ACCOUNT_SWITCHED, { login: result.login });
      }

      return result;
    } finally {
      inflightLoginControllers.delete(controller);
    }
  });

  // Lets the renderer abort all in-flight device-code logins (e.g. user cancels
  // the Add Account modal). Each in-flight startLogin owns its own
  // AbortController; aborting them trips the polling loop's exit condition.
  // In E2E mode it short-circuits the stub resolver instead.
  ipcMain.handle(IPC.AUTH.CANCEL_LOGIN, async () => {
    if (E2E_ENABLED && e2eStartLoginResolver) {
      e2eStartLoginResolver({ success: false });
      e2eStartLoginResolver = null;
      return;
    }
    for (const controller of inflightLoginControllers) {
      controller.abort();
    }
  });

  ipcMain.handle(IPC.AUTH.SWITCH_ACCOUNT, async (_event, login: string) => {
    const accounts = await authService.listAccounts();
    if (!accounts.some((account) => account.login === login)) {
      throw new Error(`Account ${login} is not available`);
    }

    authService.setActiveLogin(login);
    broadcast(IPC.AUTH.ACCOUNT_SWITCH_STARTED, { login });
    await reloadMindsAfterAuthChange('account switch');
    broadcast(IPC.AUTH.ACCOUNT_SWITCHED, { login });
  });

  ipcMain.handle(IPC.AUTH.LOGOUT, async () => {
    await authService.logout();
    await reloadMindsAfterAuthChange('logout');
    broadcast(IPC.AUTH.LOGGED_OUT);
  });

  // Test-only handlers — gated on CHAMBER_E2E=1 so they are never registered
  // in production builds. Mirrors the existing e2e:a2a:incoming pattern.
  if (E2E_ENABLED) {
    ipcMain.handle(IPC.E2E.AUTH_EMIT_PROGRESS, async (_event, payload: Record<string, unknown>) => {
      broadcast(IPC.AUTH.PROGRESS, payload);
    });

    ipcMain.handle(IPC.E2E.AUTH_COMPLETE_LOGIN, async (_event, payload: { success?: boolean; login?: string }) => {
      const resolver = e2eStartLoginResolver;
      e2eStartLoginResolver = null;
      if (resolver) {
        resolver({ success: payload?.success ?? true, login: payload?.login });
      }
    });
  }
}
