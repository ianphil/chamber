import React from 'react';

export type DeviceCodeStage = 'starting' | 'waiting' | 'error';

interface Props {
  stage: DeviceCodeStage;
  userCode?: string;
  error?: string;
  onTryAgain?: () => void;
}

/**
 * Pure presentational component that renders the GitHub device-code prompt.
 *
 * Visual contract mirrors AuthScreen so the user sees identical guidance whether
 * they sign in for the first time or add a second account from Settings.
 *
 * Accessibility: the parent dialog provides role="dialog"/aria-modal/focus trap.
 * This component only renders content.
 */
export function DeviceCodePrompt({ stage, userCode, error, onTryAgain }: Props) {
  if (stage === 'error') {
    return (
      <div className="space-y-4" role="alert">
        <p className="text-sm text-destructive">{error ?? 'Authentication failed.'}</p>
        {onTryAgain ? (
          <button
            type="button"
            onClick={onTryAgain}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {userCode ? (
        <>
          <p className="text-sm text-muted-foreground">
            Enter this code at{' '}
            <span className="text-foreground font-medium">github.com/login/device</span>
          </p>
          <div
            className="font-mono text-3xl font-bold tracking-widest text-foreground select-all"
            aria-label={`Device code ${userCode.split('').join(' ')}`}
          >
            {userCode}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Starting authentication…</p>
      )}
      <div className="flex items-center justify-center gap-3">
        <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
        <p className="text-xs text-muted-foreground">Waiting for authorization…</p>
      </div>
    </div>
  );
}
