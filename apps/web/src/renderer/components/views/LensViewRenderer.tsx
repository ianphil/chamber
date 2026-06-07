import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';
import { LensBriefing } from './LensBriefing';
import { LensTable } from './LensTable';
import { LensDetail } from './LensDetail';
import { LensStatusBoard } from './LensStatusBoard';
import { LensTimeline } from './LensTimeline';
import { LensEditor } from './LensEditor';
import { LensForm } from './LensForm';
import { CanvasLensView } from './CanvasLensView';
import { Skeleton } from '../ui/skeleton';

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
  if (view.view === 'canvas') {
    return <CanvasLensView view={view} />;
  }

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
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
        if (!cancelled) setInitializing(false);
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
  const isProseView = view.view === 'detail';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
      {/* Wide views (table/status-board/timeline) fill the pane. Detail is
          running prose, so cap it at the ~65ch reading measure; other views
          (form/briefing/editor) stay at max-w-2xl for their grids. */}
      <div className={cn('mx-auto w-full space-y-6', isWideView ? 'max-w-none' : isProseView ? 'max-w-prose' : 'max-w-2xl')}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight truncate">{view.name}</h2>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{view.view} view</p>
          </div>
          {view.prompt && (
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={cn(
                'surface-card surface-card-hover flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-border bg-card text-muted-foreground hover:text-foreground',
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
        {initializing && !data && !error ? (
          <LensViewSkeleton wide={isWideView} />
        ) : data ? (
          <div className="chamber-fade-in">
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
          </div>
        ) : (
          <div className="surface-card rounded-xl border border-border bg-card px-6 py-10 text-center flex flex-col items-center">
            <div className="h-11 w-11 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Sparkles size={18} className="text-primary-foreground" />
            </div>
            {view.prompt ? (
              <>
                <p className="text-sm font-medium text-foreground">No data yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  {view.description || 'Generate this view to populate it with live data from the mind.'}
                </p>
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className={cn(
                    'mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99]',
                    loading && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                  {loading ? 'Generating…' : 'Generate'}
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data available.</p>
            )}
          </div>
        )}

        {/* Action input — write-back via agent */}
        {data && (
          <div className="focus-halo flex items-center gap-2 bg-secondary rounded-xl border border-border px-2 py-1.5 transition-[border-color,box-shadow] duration-200">
            <input
              type="text"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAction(); }}
              placeholder="Ask the agent to modify this view…"
              disabled={loading}
              className="flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              onClick={handleAction}
              disabled={loading || !actionInput.trim()}
              className={cn(
                'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                actionInput.trim() && !loading
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
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

/**
 * Initial-load placeholder for a Lens view. Reserves the content area while
 * the first `getViewData` call resolves so the pane doesn't flash the empty
 * "No data yet" state before real content arrives. Generic card+rows shape
 * works for every view kind; `wide` widens the rows for table-style views.
 */
function LensViewSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className="space-y-4" data-testid="lens-view-skeleton" aria-busy="true">
      <div className="surface-card rounded-xl border border-border bg-card p-5 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className={cn('h-3', wide ? 'w-[90%]' : 'w-[70%]')} />
      </div>
      <div className="surface-card rounded-xl border border-border bg-card p-5 space-y-3">
        {Array.from({ length: wide ? 5 : 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
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
