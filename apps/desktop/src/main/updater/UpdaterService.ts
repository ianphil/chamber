import { autoUpdater, type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { DesktopUpdateActionResult, DesktopUpdateState } from '@chamber/shared/types';

import {
  canCheckForUpdates,
  canDownloadUpdate,
  canInstallUpdate,
  createUpdateState,
  reduceOnChecking,
  reduceOnDownloadComplete,
  reduceOnDownloadProgress,
  reduceOnError,
  reduceOnInstalling,
  reduceOnNoUpdate,
  reduceOnUpdateAvailable,
} from './updateMachine';

const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface UpdaterLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface UpdaterServiceOptions {
  readonly currentVersion: string;
  readonly isPackaged: boolean;
  readonly updater?: AppUpdater;
  readonly logger?: UpdaterLogger;
  readonly allowDevUpdates?: boolean;
  readonly setQuitting?: () => void;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UpdaterService {
  private readonly updater: AppUpdater;
  private readonly logger: UpdaterLogger;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private readonly setQuitting?: () => void;
  private state: DesktopUpdateState;
  private checkInFlight = false;
  private downloadInFlight = false;
  private installInFlight = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(options: UpdaterServiceOptions) {
    this.updater = options.updater ?? autoUpdater;
    this.logger = options.logger ?? console;
    this.setQuitting = options.setQuitting;
    const enabled = options.isPackaged || options.allowDevUpdates === true;
    this.state = createUpdateState(
      options.currentVersion,
      enabled,
      enabled ? undefined : 'Updates are available only in packaged builds.',
    );
    this.configureUpdater();
  }

  getState(): DesktopUpdateState {
    return this.state;
  }

  onStateChanged(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.state.enabled) return;
    this.clearTimers();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkForUpdates('startup');
    }, AUTO_UPDATE_STARTUP_DELAY_MS);
    this.startupTimer.unref();

    this.pollTimer = setInterval(() => {
      void this.checkForUpdates('poll');
    }, AUTO_UPDATE_POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  stop(): void {
    this.clearTimers();
  }

  async checkForUpdates(reason = 'manual'): Promise<DesktopUpdateActionResult> {
    if (!canCheckForUpdates(this.state) || this.checkInFlight) {
      return { success: false, message: `Cannot check for updates while status is ${this.state.status}.` };
    }

    this.checkInFlight = true;
    try {
      this.logger.info(`[updater] Checking for updates (${reason}).`);
      await this.updater.checkForUpdates();
      return { success: true };
    } catch (error) {
      const message = formatError(error);
      this.setState(reduceOnError(this.state, message, 'check'));
      return { success: false, message };
    } finally {
      this.checkInFlight = false;
    }
  }

  async downloadUpdate(): Promise<DesktopUpdateActionResult> {
    if (!canDownloadUpdate(this.state) || this.downloadInFlight) {
      return { success: false, message: `Cannot download update while status is ${this.state.status}.` };
    }

    this.downloadInFlight = true;
    try {
      await this.updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      const message = formatError(error);
      this.setState(reduceOnError(this.state, message, 'download'));
      return { success: false, message };
    } finally {
      this.downloadInFlight = false;
    }
  }

  installAndRestart(): DesktopUpdateActionResult {
    if (!canInstallUpdate(this.state) || this.installInFlight) {
      return { success: false, message: `Cannot install update while status is ${this.state.status}.` };
    }

    this.installInFlight = true;
    this.setState(reduceOnInstalling(this.state));
    this.setQuitting?.();
    this.updater.quitAndInstall(true, true);
    return { success: true };
  }

  private configureUpdater(): void {
    if (!this.state.enabled) return;

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;

    this.updater.on('checking-for-update', () => {
      this.setState(reduceOnChecking(this.state));
    });
    this.updater.on('update-available', (info: UpdateInfo) => {
      this.setState(reduceOnUpdateAvailable(this.state, info.version, new Date().toISOString()));
      this.logger.info(`[updater] Update available: ${info.version}`);
    });
    this.updater.on('update-not-available', () => {
      this.setState(reduceOnNoUpdate(this.state, new Date().toISOString()));
      this.logger.info('[updater] No updates available.');
    });
    this.updater.on('download-progress', (progress: ProgressInfo) => {
      this.setState(reduceOnDownloadProgress(this.state, progress.percent));
    });
    this.updater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState(reduceOnDownloadComplete(this.state, info.version));
      this.logger.info(`[updater] Update downloaded: ${info.version}`);
    });
    this.updater.on('error', (error: Error) => {
      if (this.installInFlight) {
        this.installInFlight = false;
      }
      const message = formatError(error);
      this.setState(reduceOnError(this.state, message, 'event'));
      this.logger.error(`[updater] ${message}`);
    });
  }

  private setState(nextState: DesktopUpdateState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private clearTimers(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
