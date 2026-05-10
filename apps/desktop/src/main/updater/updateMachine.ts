import type { DesktopUpdateState } from '@chamber/shared/types';

export function createUpdateState(
  currentVersion: string,
  enabled: boolean,
  disabledReason?: string,
): DesktopUpdateState {
  if (!enabled) {
    return {
      enabled: false,
      status: 'disabled',
      currentVersion,
      downloadPercent: null,
      canRetry: false,
      message: disabledReason ?? 'Updates are disabled.',
    };
  }

  return {
    enabled: true,
    status: 'idle',
    currentVersion,
    downloadPercent: null,
    canRetry: false,
    message: null,
  };
}

export function canCheckForUpdates(state: DesktopUpdateState): boolean {
  return state.enabled
    && state.status !== 'checking'
    && state.status !== 'downloading'
    && state.status !== 'downloaded'
    && state.status !== 'installing';
}

export function canDownloadUpdate(state: DesktopUpdateState): boolean {
  return state.enabled && state.status === 'available' && Boolean(state.availableVersion);
}

export function canInstallUpdate(state: DesktopUpdateState): boolean {
  return state.enabled && state.status === 'downloaded' && Boolean(state.downloadedVersion);
}

export function reduceOnChecking(state: DesktopUpdateState): DesktopUpdateState {
  return {
    ...state,
    status: 'checking',
    message: 'Checking for updates...',
    errorContext: undefined,
    canRetry: false,
  };
}

export function reduceOnUpdateAvailable(
  state: DesktopUpdateState,
  availableVersion: string,
  checkedAt: string,
): DesktopUpdateState {
  return {
    ...state,
    status: 'available',
    availableVersion,
    checkedAt,
    downloadPercent: null,
    message: `Update ${availableVersion} is available.`,
    errorContext: undefined,
    canRetry: false,
  };
}

export function reduceOnNoUpdate(state: DesktopUpdateState, checkedAt: string): DesktopUpdateState {
  return {
    ...state,
    status: 'up-to-date',
    checkedAt,
    downloadPercent: null,
    message: 'Chamber is up to date.',
    errorContext: undefined,
    canRetry: false,
  };
}

export function reduceOnDownloadProgress(
  state: DesktopUpdateState,
  percent: number,
): DesktopUpdateState {
  return {
    ...state,
    status: 'downloading',
    downloadPercent: Math.max(0, Math.min(100, percent)),
    message: 'Downloading update...',
    errorContext: undefined,
    canRetry: false,
  };
}

export function reduceOnDownloadComplete(
  state: DesktopUpdateState,
  downloadedVersion: string,
): DesktopUpdateState {
  return {
    ...state,
    status: 'downloaded',
    downloadedVersion,
    downloadPercent: 100,
    message: `Update ${downloadedVersion} is ready to install.`,
    errorContext: undefined,
    canRetry: false,
  };
}

export function reduceOnInstalling(state: DesktopUpdateState): DesktopUpdateState {
  return {
    ...state,
    status: 'installing',
    message: 'Restarting to install update...',
    canRetry: false,
  };
}

export function reduceOnError(
  state: DesktopUpdateState,
  message: string,
  errorContext: string,
): DesktopUpdateState {
  return {
    ...state,
    status: 'error',
    message,
    errorContext,
    canRetry: state.availableVersion !== undefined || state.downloadedVersion !== undefined,
  };
}
