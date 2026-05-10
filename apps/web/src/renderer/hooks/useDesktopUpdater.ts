import { useCallback, useEffect, useState } from 'react';
import type { DesktopUpdateState } from '@chamber/shared/types';

export function useDesktopUpdater() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    let mounted = true;
    window.electronAPI.updater.getState()
      .then((nextState) => {
        if (mounted) setState(nextState);
      })
      .catch(() => {
        if (mounted) {
          setState({
            enabled: false,
            status: 'disabled',
            currentVersion: 'unknown',
            downloadPercent: null,
            message: 'Updater is unavailable.',
            canRetry: false,
          });
        }
      });

    const unsubscribe = window.electronAPI.updater.onStateChanged((nextState) => {
      if (mounted) setState(nextState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const check = useCallback(() => window.electronAPI.updater.check(), []);
  const download = useCallback(() => window.electronAPI.updater.download(), []);
  const installAndRestart = useCallback(() => window.electronAPI.updater.installAndRestart(), []);

  return {
    state,
    check,
    download,
    installAndRestart,
  };
}
