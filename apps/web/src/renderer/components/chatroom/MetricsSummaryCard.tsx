// ---------------------------------------------------------------------------
// MetricsSummaryCard — shows orchestration stats after completion
// ---------------------------------------------------------------------------

export function MetricsSummaryCard({ metrics }: {
  metrics: { elapsedMs: number; totalTasks: number; completedTasks: number; failedTasks: number; agentsUsed: number; orchestrationMode: string };
}) {
  const mins = Math.floor(metrics.elapsedMs / 60000);
  const secs = Math.floor((metrics.elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-2">
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-secondary/60 border border-border text-xs">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/60"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="text-foreground/70">{timeStr}</span>
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/60"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="text-foreground/70">{metrics.agentsUsed} agent{metrics.agentsUsed !== 1 ? 's' : ''}</span>
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <div className="flex items-center gap-1.5">
          {metrics.failedTasks === 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          )}
          <span className="text-foreground/70">{metrics.completedTasks}/{metrics.totalTasks} tasks</span>
          {metrics.failedTasks > 0 && <span className="text-amber-500">({metrics.failedTasks} failed)</span>}
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <span className="text-foreground/50 uppercase tracking-wide">{metrics.orchestrationMode}</span>
      </div>
    </div>
  );
}
