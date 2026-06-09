import React, { useState, useEffect } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Camera, LogOut, UserRound } from 'lucide-react';
import type { MarketplaceRegistry, UserProfile } from '@chamber/shared/types';
import { APP_VERSION } from '@/renderer/lib/appVersion';
import { useAppState } from '../../lib/store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { AddAccountModal } from './AddAccountModal';
import { LocalLlmSettingsSection } from './LocalLlmSettingsSection';
import { VoiceDictationSettingsSection } from './VoiceDictationSettingsSection';

const ADD_ACCOUNT_VALUE = '__add-account__';

export function SettingsView() {
  const { featureFlags } = useAppState();
  const [login, setLogin] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ login: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [marketplaces, setMarketplaces] = useState<MarketplaceRegistry[]>([]);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [marketplaceMessage, setMarketplaceMessage] = useState<string | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addAccountIntent, setAddAccountIntent] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [profileAbout, setProfileAbout] = useState('');
  const [profileLocation, setProfileLocation] = useState('');
  const [profileWork, setProfileWork] = useState('');
  const [profileAvatarDataUrl, setProfileAvatarDataUrl] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileImporting, setProfileImporting] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.userProfile.get()
      .then((profile) => {
        if (!cancelled) applyUserProfile(profile);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProfileMessage(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshMarketplaces = async () => {
    setMarketplaces(await window.electronAPI.marketplace.listGenesisRegistries());
  };

  useEffect(() => {
    void refreshMarketplaces().catch((err: unknown) => {
      setMarketplaceMessage(getErrorMessage(err));
    });
  }, []);

  const handleAccountChange = async (value: string) => {
    if (value === ADD_ACCOUNT_VALUE) {
      setAddAccountIntent((prev) => prev + 1);
      setAddAccountOpen(true);
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

  const handleRetryAddAccount = () => {
    void window.electronAPI.auth.cancelLogin?.().catch(() => {});
    setAddAccountIntent((prev) => prev + 1);
  };

  const applyUserProfile = (profile: UserProfile) => {
    setProfileName(profile.displayName);
    setProfileWork(profile.work);
    setProfileLocation(profile.location);
    setProfileAbout(profile.about);
    setProfileAvatarDataUrl(profile.avatarDataUrl);
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const profile = await window.electronAPI.userProfile.save({
        displayName: profileName,
        work: profileWork,
        location: profileLocation,
        about: profileAbout,
        avatarDataUrl: profileAvatarDataUrl,
      });
      applyUserProfile(profile);
      setProfileMessage('Profile saved.');
    } catch (err) {
      setProfileMessage(getErrorMessage(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const handleImportWorkProfile = async () => {
    setProfileImporting(true);
    setProfileMessage('Importing Microsoft 365 profile…');
    try {
      const result = await window.electronAPI.userProfile.importFromMicrosoft();
      if (!result.success) {
        setProfileMessage(result.cancelled ? 'Microsoft 365 profile import was cancelled.' : result.error);
        return;
      }
      applyUserProfile(result.profile);
      setProfileMessage('Imported Microsoft 365 profile. You can edit the fields and save local changes.');
    } catch (err) {
      setProfileMessage(getErrorMessage(err));
    } finally {
      setProfileImporting(false);
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
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Profile</h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => { void handleImportWorkProfile(); }}
              disabled={profileImporting}
              aria-label="Import profile photo from Microsoft 365"
              className="group relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
            >
              {profileAvatarDataUrl ? (
                <img src={profileAvatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserRound size={40} />
              )}
              <span className="absolute inset-0 flex items-end justify-center bg-black/55 pb-3 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera size={13} className="mr-1" />
                Import
              </span>
            </button>

            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-name">
                  Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="How Chamber should address you"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-work">
                    Work
                  </label>
                  <input
                    id="profile-work"
                    type="text"
                    value={profileWork}
                    onChange={(event) => setProfileWork(event.target.value)}
                    placeholder="Role, team, or company"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-location">
                    Location
                  </label>
                  <input
                    id="profile-location"
                    type="text"
                    value={profileLocation}
                    onChange={(event) => setProfileLocation(event.target.value)}
                    placeholder="City, office, or timezone"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="profile-about">
                  About
                </label>
                <textarea
                  id="profile-about"
                  value={profileAbout}
                  onChange={(event) => setProfileAbout(event.target.value)}
                  placeholder="A little context your agents should know about you"
                  rows={3}
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => { void handleImportWorkProfile(); }}
                  disabled={profileImporting}
                  className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                >
                  {profileImporting ? 'Importing…' : 'Import from work account'}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSaveProfile(); }}
                  disabled={profileSaving}
                  className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {profileSaving ? 'Saving…' : 'Save profile'}
                </button>
                <span className="text-xs text-muted-foreground">
                  Pulls name and photo from Microsoft Graph.
                </span>
              </div>
              {profileMessage ? (
                <p role="status" className="text-xs text-muted-foreground">{profileMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

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
                  <SelectTrigger className="mt-2 min-w-56" aria-label="Select account">
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

      {featureFlags.byoLlm ? <LocalLlmSettingsSection /> : null}
      {featureFlags.voiceDictation ? <VoiceDictationSettingsSection /> : null}

      <AddAccountModal
        open={addAccountOpen}
        openId={addAccountIntent}
        onClose={() => setAddAccountOpen(false)}
        onRetry={handleRetryAddAccount}
      />

      <p className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        Chamber v{APP_VERSION}
      </p>
    </div>
  );
}
