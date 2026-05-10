import React, { useEffect, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { DeviceCodePrompt, type DeviceCodeStage } from '../auth/DeviceCodePrompt';

interface Props {
  open: boolean;
  /**
   * Monotonically increasing identifier the parent bumps every time it intends
   * to start a new authentication flow. The component uses this to (a) avoid
   * re-triggering startLogin under React StrictMode's double-invoke and
   * (b) drive Try Again as a fresh intent owned by the parent.
   */
  openId: number;
  onClose: () => void;
  /** Parent bumps `openId` to retry; component just signals the intent. */
  onRetry: () => void;
}

/**
 * Modal that drives the GitHub device-code flow when adding an account from Settings.
 *
 * Bug being fixed (#214): SettingsView previously called `auth.startLogin()` without
 * subscribing to `auth.onProgress`, so the device code was never displayed.
 *
 * Design notes:
 *   - Subscribe BEFORE calling startLogin (renderer subscription is synchronous;
 *     IPC + HTTP roundtrip happens after, so no events are missed).
 *   - StrictMode-safe: a `startedRef` keyed on `openId` ensures startLogin fires
 *     once per user-initiated open, even though useEffect runs setup → cleanup →
 *     setup in dev. Cleanup intentionally does NOT cancel the in-flight login;
 *     only explicit user dismissal (Cancel button or ESC) calls cancelLogin.
 *   - Backdrop clicks are ignored to prevent accidental dismissal mid-flow.
 *   - On `step:'authenticated'`, the modal closes and SettingsView's existing
 *     `auth:accountSwitched` listener refreshes the dropdown — no extra wiring.
 */
export function AddAccountModal({ open, openId, onClose, onRetry }: Props) {
  const [stage, setStage] = useState<DeviceCodeStage>('starting');
  const [userCode, setUserCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const startedRef = useRef<number>(0);

  useEffect(() => {
    if (!open) return;

    const isReentry = startedRef.current === openId;

    if (!isReentry) {
      startedRef.current = openId;
      setStage('starting');
      setUserCode(undefined);
      setError(undefined);
    }

    let cancelled = false;

    const unsub = window.electronAPI.auth.onProgress((progress) => {
      if (cancelled) return;
      if (progress.step === 'device_code' && progress.userCode) {
        setUserCode(progress.userCode);
        setStage('waiting');
      } else if (progress.step === 'authenticated') {
        setStage('waiting');
        onClose();
      } else if (progress.step === 'error') {
        setError(progress.error ?? 'Authentication failed.');
        setStage('error');
      }
    });

    if (!isReentry) {
      void (async () => {
        try {
          const result = await window.electronAPI.auth.startLogin();
          if (cancelled) return;
          if (!result.success) {
            setStage((prev) => (prev === 'error' ? prev : 'error'));
            setError((prev) => prev ?? 'Authentication did not complete.');
          }
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setStage('error');
        }
      })();
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [open, openId, onClose]);

  const handleDismissExplicit = () => {
    void window.electronAPI.auth.cancelLogin?.().catch(() => {});
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    handleDismissExplicit();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add a GitHub account</DialogTitle>
          <DialogDescription>
            Sign in with GitHub to add another Copilot account to Chamber.
          </DialogDescription>
        </DialogHeader>

        <DeviceCodePrompt
          stage={stage}
          userCode={userCode}
          error={error}
          onTryAgain={stage === 'error' ? onRetry : undefined}
        />

        <DialogFooter>
          <button
            type="button"
            onClick={handleDismissExplicit}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
