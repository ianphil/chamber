import type { App } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';

type UpdaterSmokeMode = 'check' | 'download-install';

function isSmokeMode(value: string | undefined): value is UpdaterSmokeMode {
  return value === 'check' || value === 'download-install';
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function createLogger(app: App) {
  const logPath = process.env.CHAMBER_UPDATER_SMOKE_LOG
    ?? path.join(app.getPath('userData'), 'updater-smoke.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  return {
    path: logPath,
    write(event: string, payload: Record<string, unknown> = {}) {
      fs.appendFileSync(logPath, `${JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...payload,
      })}\n`, 'utf8');
    },
  };
}

function waitForDownload(log: ReturnType<typeof createLogger>): Promise<UpdateInfo> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for update-downloaded.'));
    }, 180_000);

    autoUpdater.once('update-downloaded', (info) => {
      clearTimeout(timeout);
      resolve(info);
    });
    autoUpdater.once('error', (error) => {
      clearTimeout(timeout);
      log.write('error', { error: serializeError(error) });
      reject(error);
    });
  });
}

export function runUpdaterSmoke(app: App): boolean {
  const mode = process.env.CHAMBER_UPDATER_SMOKE;
  if (!isSmokeMode(mode)) return false;

  const log = createLogger(app);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => log.write('checking-for-update'));
  autoUpdater.on('update-available', (info) => log.write('update-available', { version: info.version }));
  autoUpdater.on('update-not-available', (info) => {
    log.write('update-not-available', { version: info.version });
    if (mode === 'download-install') {
      app.exit(10);
    }
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    log.write('download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on('error', (error) => log.write('error', { error: serializeError(error) }));

  setTimeout(() => {
    void (async () => {
      try {
        log.write('start', {
          mode,
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          logPath: log.path,
        });

        const result = await autoUpdater.checkForUpdates();
        log.write('check-complete', { version: result?.updateInfo.version });

        if (mode === 'check') {
          app.exit(0);
          return;
        }

        const downloaded = waitForDownload(log);
        await autoUpdater.downloadUpdate();
        const info = await downloaded;
        log.write('downloaded', { version: info.version });
        log.write('quit-and-install');
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        log.write('fatal', { error: serializeError(error) });
        app.exit(20);
      }
    })();
  }, 1_000);

  return true;
}
