/**
 * Four-phase consolidation pipeline for MEMORY.md.
 * orient → gather → consolidate → prune
 *
 * Pure functions — no file I/O, no database access.
 *
 * Ported from SCNS (`scns/src/dream/consolidation.ts`).
 */
import type { MemoryEntry } from './memory-entries';
import {
  parseMemoryMd,
  serializeMemoryMd,
  deduplicateEntries,
  resolveContradictions,
  validateMemoryEntry,
} from './memory-entries';
import {
  truncateEntrypoint,
  countLines,
  countBytes,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
} from './memory-limits';
import { convertRelativeDates } from './date-utils';
import { sortByPriority, trimToFit } from './consolidation-priorities';

export interface ConsolidationInput {
  readonly currentMemoryMd: string;
  readonly newEntries: ReadonlyArray<MemoryEntry>;
  readonly referenceDate?: Date;
}

export interface ConsolidationPhaseLog {
  readonly orient: { existingEntries: number };
  readonly gather: { newEntries: number };
  readonly consolidate: { merged: number; deduped: number; contradictions: number };
  readonly prune: {
    beforeLines: number;
    afterLines: number;
    beforeBytes: number;
    afterBytes: number;
  };
}

export interface ConsolidationResult {
  readonly memoryMd: string;
  readonly entriesProcessed: number;
  readonly entriesKept: number;
  readonly duplicatesRemoved: number;
  readonly contradictionsResolved: number;
  readonly truncated: boolean;
  readonly phases: ConsolidationPhaseLog;
}

export function orient(
  currentMemoryMd: string,
  referenceDate: Date = new Date(),
): ReadonlyArray<MemoryEntry> {
  const entries = parseMemoryMd(currentMemoryMd);
  return entries.map((e) => ({
    ...e,
    content: convertRelativeDates(e.content, referenceDate),
    description: convertRelativeDates(e.description, referenceDate),
  }));
}

export function gather(
  newEntries: ReadonlyArray<MemoryEntry>,
  referenceDate: Date = new Date(),
): ReadonlyArray<MemoryEntry> {
  return newEntries
    .filter((e) => validateMemoryEntry(e))
    .map((e) => ({
      ...e,
      content: convertRelativeDates(e.content, referenceDate),
      description: convertRelativeDates(e.description, referenceDate),
    }));
}

export interface ConsolidateResult {
  readonly entries: ReadonlyArray<MemoryEntry>;
  readonly deduped: number;
  readonly contradictions: number;
}

export function consolidate(
  existing: ReadonlyArray<MemoryEntry>,
  gathered: ReadonlyArray<MemoryEntry>,
): ConsolidateResult {
  const merged = [...existing, ...gathered];
  const mergedCount = merged.length;

  const afterContradictions = resolveContradictions(merged);
  const contradictions = mergedCount - afterContradictions.length;

  const afterDedup = deduplicateEntries(afterContradictions);
  const deduped = afterContradictions.length - afterDedup.length;

  const sorted = sortByPriority(afterDedup);

  return { entries: sorted, deduped, contradictions };
}

export interface PruneResult {
  readonly entries: ReadonlyArray<MemoryEntry>;
  readonly truncated: boolean;
  readonly linesRemoved: number;
}

export function prune(entries: ReadonlyArray<MemoryEntry>): PruneResult {
  if (entries.length === 0) {
    return { entries: [], truncated: false, linesRemoved: 0 };
  }

  const beforeSerialized = serializeMemoryMd(entries);
  const beforeLines = countLines(beforeSerialized);

  const trimmed = trimToFit(entries, MAX_ENTRYPOINT_LINES, MAX_ENTRYPOINT_BYTES);

  if (trimmed.length === 0 && entries.length > 0) {
    const truncResult = truncateEntrypoint(beforeSerialized);
    const reparsed = parseMemoryMd(truncResult.content);
    const afterLines = countLines(serializeMemoryMd(reparsed));
    return {
      entries: reparsed,
      truncated: true,
      linesRemoved: beforeLines - afterLines,
    };
  }

  const serialized = serializeMemoryMd(trimmed);
  const truncResult = truncateEntrypoint(serialized);

  if (truncResult.truncated) {
    const reparsed = parseMemoryMd(truncResult.content);
    const afterLines = countLines(serializeMemoryMd(reparsed));
    return {
      entries: reparsed,
      truncated: true,
      linesRemoved: beforeLines - afterLines,
    };
  }

  const afterLines = countLines(serialized);
  return {
    entries: trimmed,
    truncated: false,
    linesRemoved: beforeLines - afterLines,
  };
}

export function runConsolidation(input: ConsolidationInput): ConsolidationResult {
  const refDate = input.referenceDate ?? new Date();

  const oriented = orient(input.currentMemoryMd, refDate);
  const gathered = gather(input.newEntries, refDate);
  const consolidated = consolidate(oriented, gathered);

  const beforePrune = serializeMemoryMd(consolidated.entries);
  const beforePruneLines = countLines(beforePrune);
  const beforePruneBytes = countBytes(beforePrune);
  const pruned = prune(consolidated.entries);
  const finalMd = serializeMemoryMd(pruned.entries);

  let resultMd = finalMd;
  if (pruned.truncated) {
    const truncResult = truncateEntrypoint(finalMd);
    resultMd = truncResult.truncated ? truncResult.content : finalMd;
  }

  const afterMd = resultMd;
  const afterLines = countLines(afterMd);
  const afterBytes = countBytes(afterMd);

  return {
    memoryMd: afterMd,
    entriesProcessed: oriented.length + gathered.length,
    entriesKept: pruned.entries.length,
    duplicatesRemoved: consolidated.deduped,
    contradictionsResolved: consolidated.contradictions,
    truncated: pruned.truncated,
    phases: {
      orient: { existingEntries: oriented.length },
      gather: { newEntries: gathered.length },
      consolidate: {
        merged: oriented.length + gathered.length,
        deduped: consolidated.deduped,
        contradictions: consolidated.contradictions,
      },
      prune: {
        beforeLines: beforePruneLines,
        afterLines,
        beforeBytes: beforePruneBytes,
        afterBytes,
      },
    },
  };
}
