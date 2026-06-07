import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';

interface Props {
  onAuthenticated: () => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [stage, setStage] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const [userCode, setUserCode] = useState('');
  const [login, setLogin] = useState('');
  const [error, setError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  const handleCopyCode = () => {
    if (!userCode) return;
    void navigator.clipboard?.writeText(userCode).then(() => {
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1500);
    }).catch(() => {
      // Clipboard may be unavailable; silently ignore.
    });
  };

  const handleSignIn = async () => {
    setStage('waiting');
    setError('');

    const unsub = window.electronAPI.auth.onProgress((progress) => {
      if (progress.step === 'device_code' && progress.userCode) {
        setUserCode(progress.userCode);
      }
      if (progress.step === 'authenticated' && progress.login) {
        setLogin(progress.login);
        setStage('done');
        setTimeout(onAuthenticated, 1500);
      }
      if (progress.step === 'error') {
        setError(progress.error ?? 'Authentication failed');
        setStage('error');
      }
    });

    try {
      const result = await window.electronAPI.auth.startLogin();
      if (result.success) {
        setLogin(result.login ?? '');
        setStage('done');
        setTimeout(onAuthenticated, 1000);
        return;
      }
      setError(result.error ?? 'Authentication did not complete.');
      setStage('error');
    } catch (err) {
      setError(getErrorMessage(err));
      setStage('error');
    } finally {
      unsub();
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50">
      <div className="text-center space-y-8 max-w-md px-8">
        <div className="w-16 h-16 rounded-2xl bg-genesis flex items-center justify-center text-2xl font-bold text-primary-foreground mx-auto">
          C
        </div>

        <div>
          <h1 className="text-2xl font-semibold mb-2">Chamber</h1>
          <p className="text-muted-foreground text-sm">
            Sign in with your GitHub account to get started.
          </p>
        </div>

        {stage === 'idle' && (
          <div className="space-y-3">
            <button
              onClick={handleSignIn}
              className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              Sign in with GitHub
            </button>
            <p className="text-xs text-muted-foreground/80">
              Requires an active GitHub Copilot subscription.
            </p>
          </div>
        )}

        {stage === 'waiting' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {userCode ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter this code at{' '}
                  <a
                    href="https://github.com/login/device"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground font-medium underline-offset-2 hover:underline"
                  >
                    github.com/login/device
                  </a>
                </p>
                <div className="flex items-center justify-center gap-2">
                  <div className="font-mono text-3xl font-bold tracking-widest text-foreground">
                    {userCode}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    aria-label={codeCopied ? 'Code copied' : 'Copy code'}
                    title={codeCopied ? 'Copied' : 'Copy code'}
                    className="ml-1 flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {codeCopied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                    {codeCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Starting authentication...</p>
            )}
            <div className="flex items-center justify-center gap-3">
              <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">Waiting for authorization...</p>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="text-genesis text-lg">✓ Authenticated{login ? ` as @${login}` : ''}</div>
          </div>
        )}

        {stage === 'error' && (
          <div className="space-y-4">
            <p className="text-destructive text-sm">{error}</p>
            <button
              onClick={() => { setStage('idle'); setError(''); }}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
