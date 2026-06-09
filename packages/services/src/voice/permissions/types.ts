import type { VoicePermissionState } from '@chamber/shared/voice-types';

export interface PermissionInspector {
  getState(): Promise<VoicePermissionState>;
  openPreferences?(): Promise<void>;
}
