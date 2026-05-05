import React, { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import type { MarketplaceRegistry } from '@chamber/shared/types';
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
  const [marketplaces, setMarketplaces] = useState<MarketplaceRegistry[]>([]);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [marketplaceMessage, setMarketplaceMessage] = useState<string | null>(null);

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

  const refreshMarketplaces = async () => {
    setMarketplaces(await window.electronAPI.marketplace.listGenesisRegistries());
  };

  useEffect(() => {
    void refreshMarketplaces().catch((err: unknown) => {
      setMarketplaceMessage(err instanceof Error ? err.message : String(err));
    });
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

  const handleAddMarketplace = async (event: React.FormEvent) => {
    event.preventDefault();
    setMarketplaceMessage(null);
    const result = await window.electronAPI.marketplace.addGenesisRegistry(marketplaceUrl);
    if (!result.success) {
      setMarketplaceMessage(result.error);
      return;
    }
    setMarketplaceUrl('');
    setMarketplaceMessage(`Added ${result.registry.label}.`);
    await refreshMarketplaces();
  };

  const handleToggleMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.setGenesisRegistryEnabled(registry.id, !registry.enabled);
    if (!result.success) {
      setMarketplaceMessage(result.error);
      return;
    }
    await refreshMarketplaces();
  };

  const handleRefreshMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.refreshGenesisRegistry(registry.id);
    setMarketplaceMessage(result.success ? `Refreshed ${result.registry.label}.` : result.error);
  };

  const handleRemoveMarketplace = async (registry: MarketplaceRegistry) => {
    const result = await window.electronAPI.marketplace.removeGenesisRegistry(registry.id);
    if (!result.success) {
      setMarketplaceMessage(result.error);
      return;
    }
    setMarketplaceMessage(`Removed ${result.registry.label}.`);
    await refreshMarketplaces();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl space-y-8">
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

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Marketplaces</h2>
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <form className="flex gap-2" onSubmit={(event) => { void handleAddMarketplace(event); }}>
            <input
              type="url"
              value={marketplaceUrl}
              onChange={(event) => setMarketplaceUrl(event.target.value)}
              placeholder="https://github.com/agency-microsoft/genesis-minds"
              aria-label="Marketplace repository URL"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
            />
            <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
              Add
            </button>
          </form>

          {marketplaceMessage ? (
            <p role="status" className="text-sm text-muted-foreground">{marketplaceMessage}</p>
          ) : null}

          <div className="space-y-3">
            {marketplaces.map((registry) => (
              <div key={registry.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{registry.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{registry.url}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {registry.enabled ? 'Enabled' : 'Disabled'}{registry.isDefault ? ' · Default' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => { void handleToggleMarketplace(registry); }}>
                      {registry.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => { void handleRefreshMarketplace(registry); }}>
                      Refresh
                    </button>
                    {!registry.isDefault ? (
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10" onClick={() => { void handleRemoveMarketplace(registry); }}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
