import React, { useState } from 'react';
import { TypeWriter } from '../genesis/TypeWriter';

interface Props {
  onAuthenticated: () => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [stage, setStage] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const [userCode, setUserCode] = useState('');
  const [login, setLogin] = useState('');
  const [error, setError] = useState('');

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
      setError(err instanceof Error ? err.message : String(err));
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
          <TypeWriter
            text="To operate, I need access to GitHub Copilot."
            speed={30}
            className="text-muted-foreground"
          />
        </div>

        {stage === 'idle' && (
          <button
            onClick={handleSignIn}
            className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Sign in with GitHub
          </button>
        )}

        {stage === 'waiting' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {userCode ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter this code at <span className="text-foreground font-medium">github.com/login/device</span>
                </p>
                <div className="font-mono text-3xl font-bold tracking-widest text-foreground">
                  {userCode}
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
            <div className="text-green-500 text-lg">✓ Authenticated{login ? ` as @${login}` : ''}</div>
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
