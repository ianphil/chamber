import React, { useCallback, useEffect, useState } from 'react';
import type { LensViewManifest } from '@chamber/shared/types';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Logger } from '../../lib/logger';

interface Props {
  view: LensViewManifest;
}

const log = Logger.create('CanvasLensView');

export function CanvasLensView({ view }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const loadCanvasUrl = useCallback(async () => {
    const result = await window.electronAPI.lens.getCanvasUrl(view.id);
    setUrl(result);
    setFrameKey((key) => key + 1);
  }, [view.id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.electronAPI.lens.getCanvasUrl(view.id);
        if (!cancelled) {
          setUrl(result);
          setFrameKey((key) => key + 1);
        }
      } catch (err) {
        log.error(`Failed to load Canvas Lens ${view.id}:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Canvas Lens');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [view.id]);

  const handleRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await window.electronAPI.lens.refreshView(view.id);
      await loadCanvasUrl();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, [loadCanvasUrl, loading, view.id]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{view.name}</h2>
          <p className="text-xs text-muted-foreground">Canvas Lens</p>
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
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      {error && (
        <div className="m-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 p-3">
        {url ? (
          <iframe
            key={frameKey}
            title={view.name}
            src={url}
            sandbox="allow-forms allow-same-origin allow-scripts"
            className="h-full w-full rounded-lg border border-border bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
            {loading ? 'Loading Canvas Lens...' : 'Canvas Lens source not found.'}
          </div>
        )}
      </div>
    </div>
  );
}
