import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import { WorkEntryRow } from './WorkEntryRow';
import {
  MAX_VISIBLE_WORK_ENTRIES,
  truncateWorkEntries,
  workGroupLabel,
  type WorkEntry,
} from './WorkGroup.logic';

interface Props {
  entries: ReadonlyArray<WorkEntry>;
  /**
   * True if the parent message is still streaming AND this group is at
   * the end of the message. Used to auto-expand the last running tool.
   */
  isActive?: boolean;
}

export function WorkGroup({ entries, isActive = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { visible, hiddenCount } = truncateWorkEntries(entries, isExpanded);
  const label = workGroupLabel(entries);
  const hasOverflow = hiddenCount > 0 || (isExpanded && entries.length > MAX_VISIBLE_WORK_ENTRIES);
  // Find the last running tool anywhere in the group (not just the last entry).
  // A reasoning block appended after a still-running tool, or a tool whose
  // output is streaming in before the next block arrives, should still show
  // live output.
  const lastRunningToolId = findLastRunningToolId(entries);

  return (
    <div className="my-2 rounded-xl border border-border/50 bg-card/30 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
          {label} ({entries.length})
        </p>
        {hasOverflow && (
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className={cn(
              'rounded px-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/55',
              'hover:text-foreground/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {visible.map((entry) => (
          <WorkEntryRow
            key={entry.id}
            entry={entry}
            autoExpand={isActive && entry.id === lastRunningToolId}
          />
        ))}
      </div>
    </div>
  );
}

function findLastRunningToolId(entries: ReadonlyArray<WorkEntry>): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === 'tool' && entry.status === 'running') return entry.id;
  }
  return null;
}

export function hasRunningTool(entries: ReadonlyArray<WorkEntry>): boolean {
  return entries.some((e) => e.kind === 'tool' && e.status === 'running');
}
