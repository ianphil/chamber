import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Loader2, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { iconForReasoning, iconForToolName } from './workEntryIcon';
import type { WorkEntry } from './WorkGroup.logic';

interface Props {
  entry: WorkEntry;
  /**
   * When true, a streaming tool entry auto-expands so the user can watch
   * its output grow. Overridden by local user toggles.
   */
  autoExpand?: boolean;
}

export function WorkEntryRow({ entry, autoExpand = false }: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const wasAutoExpanded = useRef(false);

  // Track whether we've auto-expanded at least once; once the stream ends,
  // collapse unless the user explicitly opened it.
  useEffect(() => {
    if (autoExpand) wasAutoExpanded.current = true;
  }, [autoExpand]);

  const open = userOpen ?? (autoExpand && hasDetail(entry));
  const canToggle = hasDetail(entry);
  const toggle = () => setUserOpen((prev) => !(prev ?? open));

  const { Icon, iconClass } = iconAndTone(entry);
  const heading = headingFor(entry);
  const preview = entry.preview;

  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={canToggle ? toggle : undefined}
        disabled={!canToggle}
        aria-expanded={canToggle ? open : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
          canToggle && 'hover:bg-accent/40 cursor-pointer',
          !canToggle && 'cursor-default',
        )}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
            canToggle ? '' : 'invisible',
            open && 'rotate-90',
          )}
        />
        <Icon className={cn('h-3.5 w-3.5 shrink-0', iconClass)} />
        <span className="shrink-0 font-mono font-medium text-foreground/90">{heading}</span>
        {preview && (
          <span className="ml-1 min-w-0 flex-1 truncate font-mono text-muted-foreground/70">
            {preview}
          </span>
        )}
        {entry.kind === 'tool' && <StatusGlyph status={entry.status} />}
      </button>
      {open && canToggle && (
        <div className="mt-0.5 ml-6 mb-1">
          <EntryDetail entry={entry} />
        </div>
      )}
    </div>
  );
}

function hasDetail(entry: WorkEntry): boolean {
  if (entry.kind === 'reasoning') return entry.block.content.length > 0;
  return Boolean(entry.block.output || entry.block.error);
}

function headingFor(entry: WorkEntry): string {
  if (entry.kind === 'reasoning') return 'Thought';
  return entry.toolName;
}

function iconAndTone(entry: WorkEntry): { Icon: ReturnType<typeof iconForToolName>; iconClass: string } {
  if (entry.kind === 'reasoning') {
    return { Icon: iconForReasoning(), iconClass: 'text-muted-foreground/60' };
  }
  const Icon = iconForToolName(entry.toolName);
  const iconClass =
    entry.status === 'error'
      ? 'text-destructive-foreground'
      : entry.status === 'running'
        ? 'text-genesis'
        : 'text-foreground/80';
  return { Icon, iconClass };
}

function StatusGlyph({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-genesis" aria-label="running" />;
  }
  if (status === 'error') {
    return (
      <X className="h-3 w-3 shrink-0 text-destructive-foreground" aria-label="error" />
    );
  }
  return <Check className="h-3 w-3 shrink-0 text-emerald-400/80" aria-label="done" />;
}

function EntryDetail({ entry }: { entry: WorkEntry }) {
  if (entry.kind === 'reasoning') {
    return (
      <pre className="whitespace-pre-wrap break-words border-l-2 border-border px-3 py-1.5 text-[11px] leading-relaxed font-mono text-muted-foreground/70">
        {entry.block.content}
      </pre>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card/40">
      {entry.block.output && (
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-[11px] leading-relaxed font-mono text-muted-foreground">
          {entry.block.output}
        </pre>
      )}
      {entry.block.error && (
        <p className="px-3 py-2 text-xs text-destructive-foreground">{entry.block.error}</p>
      )}
    </div>
  );
}
