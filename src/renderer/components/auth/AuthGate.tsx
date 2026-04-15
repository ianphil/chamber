import React, { useState, useEffect } from 'react';
import { AuthScreen } from './AuthScreen';

interface Props {
  children: React.ReactNode;
}

export function AuthGate({ children }: Props) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    window.electronAPI.auth.getStatus().then((status) => {
      setAuthenticated(status.authenticated);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI.auth.onLoggedOut(() => {
      setAuthenticated(false);
    });
    return unsub;
  }, []);

  if (checking) {
    return <div className="fixed inset-0 bg-background z-50" />;
  }

  if (!authenticated) {
    return <AuthScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <>{children}</>;
}
