import { describe, expect, it } from 'vitest';

import {
  canCheckForUpdates,
  canDownloadUpdate,
  canInstallUpdate,
  createUpdateState,
  reduceOnDownloadComplete,
  reduceOnDownloadProgress,
  reduceOnInstalling,
  reduceOnUpdateAvailable,
} from './updateMachine';

describe('updateMachine', () => {
  it('creates an idle enabled state', () => {
    expect(createUpdateState('1.2.3', true)).toMatchObject({
      enabled: true,
      status: 'idle',
      currentVersion: '1.2.3',
      downloadPercent: null,
    });
  });

  it('blocks checks while an update is downloaded and waiting for install', () => {
    const available = reduceOnUpdateAvailable(createUpdateState('1.2.3', true), '1.2.4', 'now');
    const downloaded = reduceOnDownloadComplete(available, '1.2.4');

    expect(canCheckForUpdates(downloaded)).toBe(false);
    expect(canInstallUpdate(downloaded)).toBe(true);
  });

  it('allows downloads only from available state', () => {
    const idle = createUpdateState('1.2.3', true);
    const available = reduceOnUpdateAvailable(idle, '1.2.4', 'now');

    expect(canDownloadUpdate(idle)).toBe(false);
    expect(canDownloadUpdate(available)).toBe(true);
  });

  it('clamps progress and transitions to installing', () => {
    const available = reduceOnUpdateAvailable(createUpdateState('1.2.3', true), '1.2.4', 'now');
    const downloading = reduceOnDownloadProgress(available, 125);
    const downloaded = reduceOnDownloadComplete(downloading, '1.2.4');
    const installing = reduceOnInstalling(downloaded);

    expect(downloading.downloadPercent).toBe(100);
    expect(installing.status).toBe('installing');
  });
});
