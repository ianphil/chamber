import { describe, expect, it } from 'vitest';
import type { AppUpdater } from 'electron-updater';

import { UpdaterService } from './UpdaterService';

describe('UpdaterService', () => {
  it('disables automatic updates on unsupported packaged platforms', () => {
    const service = new UpdaterService({
      currentVersion: '1.2.3',
      isPackaged: true,
      isSupportedPlatform: false,
      updater: {} as AppUpdater,
    });

    expect(service.getState()).toMatchObject({
      enabled: false,
      status: 'disabled',
      message: 'Automatic updates are not available on this platform.',
    });
  });
});
