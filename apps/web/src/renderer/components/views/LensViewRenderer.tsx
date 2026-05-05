import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { LensBriefing } from './LensBriefing';
import { LensTable } from './LensTable';
import { LensDetail } from './LensDetail';
import { LensStatusBoard } from './LensStatusBoard';
import { LensTimeline } from './LensTimeline';
import { LensEditor } from './LensEditor';
import { LensForm } from './LensForm';

interface Props {
  view: LensViewManifest;
}

const log = Logger.create('LensView');

const pendingRefreshes = new Map<string, Promise<Record<string, unknown> | null>>();

function refreshLensView(viewId: string): Promise<Record<string, unknown> | null> {
  const existing = pendingRefreshes.get(viewId);
  if (existing) return existing;

  const refresh = window.electronAPI.lens.refreshView(viewId)
    .finally(() => {
      if (pendingRefreshes.get(viewId) === refresh) {
        pendingRefreshes.delete(viewId);
      }
    });
  pendingRefreshes.set(viewId, refresh);
  return refresh;
}

export function LensViewRenderer({ view }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInput, setActionInput] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const pendingRefresh = pendingRefreshes.get(view.id);
      if (pendingRefresh) setLoading(true);
      try {
        const result = await window.electronAPI.lens.getViewData(view.id);
        if (cancelled) return;
        setData(result);
        if (pendingRefresh) {
          const refreshed = await pendingRefresh;
          if (cancelled) return;
          setData(refreshed);
        }
      } catch (err) {
        log.error(`Failed to load data for ${view.id}:`, err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load view data');
      } finally {
        if (!cancelled && pendingRefresh) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [view.id]);

  const handleRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await refreshLensView(view.id);
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [view.id, loading]);

  const handleAction = useCallback(async () => {
    if (loading || !actionInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.lens.sendAction(view.id, actionInput.trim());
      setData(result);
      setActionInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }, [view.id, actionInput, loading]);

  const isWideView = view.view === 'table' || view.view === 'status-board' || view.view === 'timeline';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
      {/* Wide views (table/status-board/timeline) fill the pane.
          Prose views cap at max-w-2xl so paragraphs stay readable. */}
      <div className={cn('mx-auto w-full space-y-6', isWideView ? 'max-w-none' : 'max-w-2xl')}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{view.name}</h2>
            <p className="text-sm text-muted-foreground">{view.view} view</p>
          </div>
          {view.prompt && (
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
                'bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground',
                loading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Content */}
        {data ? (
          <LensViewContent view={view} data={data} onAction={async (action) => {
            setLoading(true);
            try {
              const result = await window.electronAPI.lens.sendAction(view.id, action);
              setData(result);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Action failed');
            } finally {
              setLoading(false);
            }
          }} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground text-sm">
              {view.prompt ? 'No data yet. Click Refresh to populate.' : 'No data available.'}
            </p>
          </div>
        )}

        {/* Action input — write-back via agent */}
        {data && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAction(); }}
              placeholder="Ask the agent to modify this view…"
              disabled={loading}
              className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              onClick={handleAction}
              disabled={loading || !actionInput.trim()}
              className={cn(
                'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                actionInput.trim() && !loading
                  ? 'bg-primary text-primary-foreground hover:opacity-80'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <Send size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LensViewContent({ view, data, onAction }: { view: LensViewManifest; data: Record<string, unknown>; onAction: (action: string) => Promise<void> }) {
  switch (view.view) {
    case 'briefing':
      return <LensBriefing data={data} schema={view.schema} />;
    case 'table':
      return <LensTable data={data} schema={view.schema} />;
    case 'detail':
      return <LensDetail data={data} schema={view.schema} />;
    case 'status-board':
      return <LensStatusBoard data={data} schema={view.schema} />;
    case 'timeline':
      return <LensTimeline data={data} schema={view.schema} />;
    case 'editor':
      return (
        <LensEditor
          data={data}
          schema={view.schema}
          onSave={(updates) => {
            const changes = Object.entries(updates)
              .filter(([k, v]) => String(v) !== String(data[k]))
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join(', ');
            if (changes) onAction(`Update the following fields: ${changes}`);
          }}
        />
      );
    case 'form':
    default:
      return <LensForm data={data} schema={view.schema} />;
  }
}
