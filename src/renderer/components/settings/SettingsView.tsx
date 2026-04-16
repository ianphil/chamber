import React, { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const ADD_ACCOUNT_VALUE = '__add-account__';

export function SettingsView() {
  const [login, setLogin] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ login: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshAccountState = async () => {
      setError(false);
      const [status, availableAccounts] = await Promise.all([
        window.electronAPI.auth.getStatus(),
        window.electronAPI.auth.listAccounts(),
      ]);
      if (cancelled) return;
      setLogin(status.login ?? null);
      setAccounts([...availableAccounts].sort((a, b) => a.login.localeCompare(b.login)));
      setLoading(false);
    };

    refreshAccountState()
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    const unsubAccountSwitched = window.electronAPI.auth.onAccountSwitched(() => {
      void refreshAccountState().catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubAccountSwitched();
    };
  }, []);

  const handleAccountChange = async (value: string) => {
    if (value === ADD_ACCOUNT_VALUE) {
      await window.electronAPI.auth.startLogin();
      return;
    }

    if (value === login) return;

    const previousLogin = login;
    setLogin(value);
    try {
      await window.electronAPI.auth.switchAccount(value);
    } catch {
      setLogin(previousLogin);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Account</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">Unable to load account info</p>
          ) : login || accounts.length > 0 ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Signed in as</p>
                <Select value={login ?? undefined} onValueChange={(value) => { void handleAccountChange(value); }}>
                  <SelectTrigger className="mt-2 min-w-56">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.login} value={account.login}>
                        {account.login}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={ADD_ACCOUNT_VALUE}>+ Add Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <button
                onClick={() => window.electronAPI.auth.logout()}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut size={16} />
                Log out
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not signed in</p>
          )}
        </div>
      </section>
    </div>
  );
}
