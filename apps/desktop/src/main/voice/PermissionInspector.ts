import { shell, systemPreferences } from 'electron';
import type { PermissionInspector } from '@chamber/services';
import type { VoicePermissionState } from '@chamber/shared/voice-types';

type ElectronMediaAccessStatus = ReturnType<typeof systemPreferences.getMediaAccessStatus>;

const MACOS_MICROPHONE_PREFERENCES_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const WINDOWS_MICROPHONE_PREFERENCES_URL = 'ms-settings:privacy-microphone';

export class ElectronPermissionInspector implements PermissionInspector {
  async getState(): Promise<VoicePermissionState> {
    if (process.platform === 'linux') return 'unsupported';
    if (process.platform !== 'darwin' && process.platform !== 'win32') return 'unsupported';

    try {
      return mapMediaAccessStatus(systemPreferences.getMediaAccessStatus('microphone'));
    } catch {
      return 'not-determined';
    }
  }

  async requestAccess(): Promise<boolean> {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  }

  async openPreferences(): Promise<void> {
    if (process.platform === 'darwin') {
      await shell.openExternal(MACOS_MICROPHONE_PREFERENCES_URL);
      return;
    }

    if (process.platform === 'win32') {
      await shell.openExternal(WINDOWS_MICROPHONE_PREFERENCES_URL);
    }
  }
}

function mapMediaAccessStatus(status: ElectronMediaAccessStatus): VoicePermissionState {
  switch (status) {
    case 'granted':
    case 'denied':
    case 'restricted':
    case 'not-determined':
      return status;
    case 'unknown':
      return 'not-determined';
  }
}
