import { useEffect, useState } from 'react';
import type { A2ARelayStatus } from '@chamber/shared/a2a-types';
import { RadioTower, ShieldCheck, Unplug, RefreshCw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';

type RelayAuthMode = 'static' | 'interactive';

const disconnectedStatus: A2ARelayStatus = {
  state: 'disconnected',
  mode: 'local',
  relayBaseUrl: null,
  publishedBaseUrl: null,
  publishedAgentCount: 0,
  relayAgentCount: 0,
  lastError: null,
  connectedAt: null,
};

export function A2ARelayView() {
  const [relayBaseUrl, setRelayBaseUrl] = useState('http://127.0.0.1:4317');
  const [authMode, setAuthMode] = useState<RelayAuthMode>('static');
  const [relayToken, setRelayToken] = useState('');
  const [status, setStatus] = useState<A2ARelayStatus>(disconnectedStatus);
  const [error, setError] = useState<string | null>(null);

  const busy = status.state === 'connecting' || status.state === 'disconnecting';
  const connected = status.state === 'connected';
  const hasStoredTokenForRelay = status.hasStoredRelayToken === true && status.relayBaseUrl === relayBaseUrl.trim();
  const canConnect = relayBaseUrl.trim().length > 0
    && (authMode === 'static' ? relayToken.trim().length > 0 || hasStoredTokenForRelay : true);

  useEffect(() => {
    let mounted = true;
    void window.electronAPI.a2a.relayStatus()
      .then((nextStatus) => {
        if (!mounted) return;
        setStatus(nextStatus);
        if (nextStatus.relayBaseUrl) setRelayBaseUrl(nextStatus.relayBaseUrl);
      })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      });
    const unsubscribe = window.electronAPI.a2a.onRelayStateChanged((nextStatus) => {
      setStatus(nextStatus);
      setError(nextStatus.lastError);
      if (nextStatus.relayBaseUrl) setRelayBaseUrl(nextStatus.relayBaseUrl);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const connect = async () => {
    setError(null);
    try {
      const nextStatus = await window.electronAPI.a2a.relayConnect(authMode === 'static'
        ? {
            relayBaseUrl,
            authMode: 'static',
            ...(relayToken.trim().length > 0 ? { relayToken } : {}),
          }
        : {
            relayBaseUrl,
            authMode: 'interactive',
          });
      setStatus(nextStatus);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      setStatus(await window.electronAPI.a2a.relayDisconnect());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const refreshStatus = async () => {
    setError(null);
    try {
      setStatus(await window.electronAPI.a2a.relayStatus());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-3 text-purple-300">
              <RadioTower size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">A2A Relay</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Connect Chamber to a relay registry for cross-agent discovery and message routing.
              </p>
            </div>
          </div>
          <StatusBadge status={status} />
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <main className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Connection</CardTitle>
                <CardDescription>
                  Static relay tokens are saved in the OS credential store. Chamber polls the relay mailbox while connected.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field
                  label="Relay base URL"
                  value={relayBaseUrl}
                  onChange={setRelayBaseUrl}
                  hint="Use an HTTPS Switchboard URL for cloud relays or an HTTP loopback URL for local relays."
                />
                <SelectField
                  label="Authentication mode"
                  onChange={(value) => setAuthMode(value as RelayAuthMode)}
                  options={[
                    { label: 'Static bearer token', value: 'static' },
                    { label: 'Microsoft Entra interactive', value: 'interactive' },
                  ]}
                  value={authMode}
                />
                {authMode === 'static' ? (
                  <Field
                    label="Relay bearer token"
                    value={relayToken}
                    onChange={setRelayToken}
                    type="password"
                    hint={hasStoredTokenForRelay ? 'Leave blank to reuse the saved OS keychain token for this relay.' : 'Used for local development and private relay instances.'}
                  />
                ) : (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Microsoft Entra opens a browser sign-in and uses Chamber's configured Switchboard app registration.
                  </div>
                )}
                {error && (
                  <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-red-200">
                    {error}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy || !canConnect}
                    onClick={connect}
                  >
                    {connected ? 'Reconnect' : 'Connect'}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-2 text-sm font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy || !connected}
                    onClick={disconnect}
                  >
                    <Unplug size={16} />
                    Disconnect
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy}
                    onClick={refreshStatus}
                  >
                    <RefreshCw size={16} />
                    Refresh status
                  </button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Behavior</CardTitle>
                <CardDescription>Relay mode uses one active A2A registry at a time.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
                  <div>
                    <div className="font-medium">Use relay as active A2A registry</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      When connected, A2A discovery and outbound routing use the relay registry. Disconnect falls back to local mode.
                    </div>
                  </div>
                  <div className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-1 ${connected ? 'border-purple-400/50 bg-purple-500/30' : 'border-border bg-muted'}`}>
                    <div className={`h-5 w-5 rounded-full bg-white transition-all ${connected ? 'ml-auto' : ''}`} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
              <strong>Safety note:</strong> static tokens are for local/private relays. Cloud Switchboard should use Microsoft Entra interactive auth.
            </div>
          </main>

          <aside className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border text-sm">
                <Metric label="Mode" value={status.mode === 'relay' ? 'Relay' : 'Local'} />
                <Metric label="Connection" value={status.state} />
                <Metric label="Published Chamber cards" value={String(status.publishedAgentCount)} />
                <Metric label="Relay agents visible" value={String(status.relayAgentCount)} />
                <Metric label="Delivery" value={connected ? 'Polling mailbox' : 'Paused'} />
                <Metric label="Connected" value={status.connectedAt ? new Date(status.connectedAt).toLocaleTimeString() : 'not connected'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current relay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ReadOnlyField label="Relay URL" value={status.relayBaseUrl ?? 'None'} />
                <ReadOnlyField label="Mailbox mode" value={connected ? 'Chamber polls for messages addressed to its local minds' : 'Disconnected'} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 pt-4 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 shrink-0 text-green-300" size={18} />
                <span>Relay tokens are not persisted by this view yet. Saved profiles should use Chamber credentials.</span>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: A2ARelayStatus }) {
  const connected = status.state === 'connected';
  const busy = status.state === 'connecting' || status.state === 'disconnecting';
  return (
    <Badge className={`w-fit gap-2 ${connected ? 'border-green-500/30 bg-green-500/10 text-green-200' : busy ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-border bg-muted text-muted-foreground'}`} variant="outline">
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]' : busy ? 'bg-amber-400' : 'bg-muted-foreground'}`} />
      {status.state}
    </Badge>
  );
}

function Field({ label, value, onChange, hint, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; hint?: string; type?: string }) {
  const id = `a2a-relay-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="block">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-purple-400"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {hint && <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  const id = `a2a-relay-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="block">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <select
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-purple-400"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-all rounded-lg border border-border bg-background p-2">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
