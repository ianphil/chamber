import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoicePermissionState } from '@chamber/shared/voice-types';

const { askForMediaAccess, getMediaAccessStatus, openExternal } = vi.hoisted(() => ({
  askForMediaAccess: vi.fn(),
  getMediaAccessStatus: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: { openExternal },
  systemPreferences: {
    askForMediaAccess,
    getMediaAccessStatus,
  },
}));

import { ElectronPermissionInspector } from './PermissionInspector';

type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

const statusCases: ReadonlyArray<readonly [MediaAccessStatus, VoicePermissionState]> = [
  ['not-determined', 'not-determined'],
  ['granted', 'granted'],
  ['denied', 'denied'],
  ['restricted', 'restricted'],
  ['unknown', 'not-determined'],
];

function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T> | T): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return Promise.resolve(run()).finally(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });
}

describe('ElectronPermissionInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openExternal.mockResolvedValue(undefined);
    askForMediaAccess.mockResolvedValue(true);
  });

  describe('getState', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      for (const [electronStatus, expectedState] of statusCases) {
        it(`maps ${electronStatus} to ${expectedState} on ${platform}`, () =>
          withPlatform(platform, async () => {
            getMediaAccessStatus.mockReturnValue(electronStatus);

            await expect(new ElectronPermissionInspector().getState()).resolves.toBe(expectedState);

            expect(getMediaAccessStatus).toHaveBeenCalledWith('microphone');
          }));
      }
    }

    it('falls back to not-determined when Windows media status lookup fails', () =>
      withPlatform('win32', async () => {
        getMediaAccessStatus.mockImplementation(() => {
          throw new Error('media access unavailable');
        });

        await expect(new ElectronPermissionInspector().getState()).resolves.toBe('not-determined');
      }));

    it('reports Linux as unsupported without querying Electron media access', () =>
      withPlatform('linux', async () => {
        await expect(new ElectronPermissionInspector().getState()).resolves.toBe('unsupported');

        expect(getMediaAccessStatus).not.toHaveBeenCalled();
      }));

    it('reports unknown platforms as unsupported without querying Electron media access', () =>
      withPlatform('freebsd', async () => {
        await expect(new ElectronPermissionInspector().getState()).resolves.toBe('unsupported');

        expect(getMediaAccessStatus).not.toHaveBeenCalled();
      }));
  });

  describe('requestAccess', () => {
    it('asks macOS for microphone access', () =>
      withPlatform('darwin', async () => {
        askForMediaAccess.mockResolvedValue(false);

        await expect(new ElectronPermissionInspector().requestAccess()).resolves.toBe(false);

        expect(askForMediaAccess).toHaveBeenCalledWith('microphone');
      }));

    for (const platform of ['win32', 'linux', 'freebsd'] as const) {
      it(`returns true without prompting on ${platform}`, () =>
        withPlatform(platform, async () => {
          await expect(new ElectronPermissionInspector().requestAccess()).resolves.toBe(true);

          expect(askForMediaAccess).not.toHaveBeenCalled();
        }));
    }
  });

  describe('openPreferences', () => {
    it('opens macOS microphone privacy preferences', () =>
      withPlatform('darwin', async () => {
        await new ElectronPermissionInspector().openPreferences();

        expect(openExternal).toHaveBeenCalledWith(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        );
      }));

    it('opens Windows microphone privacy settings', () =>
      withPlatform('win32', async () => {
        await new ElectronPermissionInspector().openPreferences();

        expect(openExternal).toHaveBeenCalledWith('ms-settings:privacy-microphone');
      }));

    for (const platform of ['linux', 'freebsd'] as const) {
      it(`does not open settings on ${platform}`, () =>
        withPlatform(platform, async () => {
          await new ElectronPermissionInspector().openPreferences();

          expect(openExternal).not.toHaveBeenCalled();
        }));
    }
  });
});
