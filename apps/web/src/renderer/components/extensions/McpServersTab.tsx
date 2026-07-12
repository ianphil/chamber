import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { Globe, Pencil, Plus, Server, Terminal, Trash2 } from 'lucide-react';
import { useAppState } from '../../lib/store';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { TabEmptyState, TabError } from './extensionsShared';
import {
  emptyMcpForm,
  entryToForm,
  formToEntry,
  validateMcpForm,
  type McpServerFormState,
} from './mcpFormUtils';

export function McpServersTab() {
  const { activeMindId, minds } = useAppState();
  const activeMind = minds.find((mind) => mind.mindId === activeMindId) ?? null;

  const [entries, setEntries] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The mind whose entries are currently displayed. Writes are only allowed
  // when this equals activeMindId, so a slow load for a previously-selected
  // mind can never persist over the newly-active mind's .mcp.json (blocker 3).
  const [loadedMindId, setLoadedMindId] = useState<string | null>(null);
  // Monotonic token: only the most recent load may apply its result. Guards
  // against an earlier getServers() resolving after the user switched minds.
  const requestSeq = useRef(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<McpServerFormState>(emptyMcpForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const mindId = activeMindId;
    setLoadedMindId(null);
    if (!mindId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.mcp.getServers(mindId);
      if (requestSeq.current !== seq) return;
      setEntries(result);
      setLoadedMindId(mindId);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(getErrorMessage(err));
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [activeMindId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Writable only once the active mind's servers have loaded. Using loadedMindId
  // as the write target means a persist is always addressed to the mind whose
  // data the user actually edited.
  const canWrite = loadedMindId !== null && loadedMindId === activeMindId && !loading;

  const persist = useCallback(
    async (next: McpServerEntry[]): Promise<McpServerEntry[]> => {
      if (loadedMindId === null || loadedMindId !== activeMindId) {
        throw new Error('The selected mind changed. Reload before saving.');
      }
      return window.electronAPI.mcp.setServers(next, loadedMindId);
    },
    [loadedMindId, activeMindId],
  );

  const otherNames = useMemo(
    () => entries.filter((entry) => entry.name !== editingName).map((entry) => entry.name),
    [entries, editingName],
  );

  const openAdd = () => {
    setEditingName(null);
    setForm(emptyMcpForm());
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (entry: McpServerEntry) => {
    setEditingName(entry.name);
    setForm(entryToForm(entry));
    setFormError(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!canWrite) {
      setFormError('The selected mind changed. Reload before saving.');
      return;
    }
    const message = validateMcpForm(form, otherNames);
    if (message) {
      setFormError(message);
      return;
    }
    const entry = formToEntry(form);
    const next = editingName
      ? entries.map((existing) => (existing.name === editingName ? entry : existing))
      : [...entries, entry];
    setSaving(true);
    setFormError(null);
    try {
      setEntries(await persist(next));
      setDialogOpen(false);
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    if (!canWrite) return;
    setError(null);
    try {
      setEntries(await persist(entries.filter((entry) => entry.name !== name)));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (!activeMindId) {
    return (
      <TabEmptyState
        icon={<Server size={22} />}
        title="No mind selected"
        detail="Select a mind from the sidebar to manage the MCP servers in its .mcp.json."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">MCP servers</h2>
          <p className="text-sm text-muted-foreground">
            Model Context Protocol servers configured in{' '}
            <span className="font-medium text-foreground">{activeMind?.identity.name ?? 'this mind'}</span>&apos;s{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.mcp.json</code>.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
          onClick={openAdd}
          disabled={saving || !canWrite}
        >
          <Plus size={16} />
          Add server
        </button>
      </div>

      {error && <TabError message={error} />}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading servers…</p>
      ) : entries.length === 0 ? (
        <TabEmptyState
          icon={<Server size={22} />}
          title="No MCP servers yet"
          detail="Add a stdio command or an HTTP endpoint to give this mind extra tools."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.name}
              className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {entry.transport === 'stdio' ? <Terminal size={16} className="text-muted-foreground" /> : <Globe size={16} className="text-muted-foreground" />}
                  <span className="font-medium">{entry.name}</span>
                  <Badge variant="outline">{entry.transport}</Badge>
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  {entry.transport === 'stdio'
                    ? [entry.command, ...entry.args].join(' ')
                    : entry.url}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  aria-label={`Edit ${entry.name}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  onClick={() => openEdit(entry)}
                  disabled={!canWrite}
                >
                  <Pencil size={16} />
                </button>
                <button
                  aria-label={`Remove ${entry.name}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-red-300 disabled:opacity-40"
                  onClick={() => void remove(entry.name)}
                  disabled={!canWrite}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingName ? 'Edit MCP server' : 'Add MCP server'}</DialogTitle>
            <DialogDescription>
              Configure a stdio launch command or a remote HTTP endpoint. Changes are written to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">.mcp.json</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <TextField
              label="Name"
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
              placeholder="filesystem"
            />
            <SelectField
              label="Transport"
              value={form.transport}
              onChange={(value) => setForm((prev) => ({ ...prev, transport: value as McpServerFormState['transport'] }))}
              options={[
                { label: 'stdio (local command)', value: 'stdio' },
                { label: 'http (remote endpoint)', value: 'http' },
              ]}
            />

            {form.transport === 'stdio' ? (
              <>
                <TextField
                  label="Command"
                  value={form.command}
                  onChange={(value) => setForm((prev) => ({ ...prev, command: value }))}
                  placeholder="npx"
                />
                <TextAreaField
                  label="Arguments"
                  hint="One argument per line."
                  value={form.argsText}
                  onChange={(value) => setForm((prev) => ({ ...prev, argsText: value }))}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                />
                <TextAreaField
                  label="Environment"
                  hint="One KEY=VALUE per line."
                  value={form.envText}
                  onChange={(value) => setForm((prev) => ({ ...prev, envText: value }))}
                  placeholder={'ROOT=/tmp'}
                />
              </>
            ) : (
              <>
                <TextField
                  label="URL"
                  value={form.url}
                  onChange={(value) => setForm((prev) => ({ ...prev, url: value }))}
                  placeholder="https://mcp.example.com/v1"
                />
                <TextAreaField
                  label="Headers"
                  hint="One KEY=VALUE per line."
                  value={form.headersText}
                  onChange={(value) => setForm((prev) => ({ ...prev, headersText: value }))}
                  placeholder={'Authorization=Bearer token'}
                />
              </>
            )}

            {formError && <TabError message={formError} />}
          </div>

          <DialogFooter>
            <button
              className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
              onClick={() => void submit()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save server'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = `mcp-field-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="block">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

function TextAreaField({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string }) {
  const id = `mcp-field-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="block">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <textarea
        className="mt-2 h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  const id = `mcp-field-${label.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <div className="block">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <select
        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
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
