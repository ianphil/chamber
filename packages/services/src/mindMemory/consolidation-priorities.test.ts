import { describe, expect, it } from 'vitest';

import {
  type EntryPriority,
  getEntryPriority,
  sortByPriority,
  trimToFit,
} from './consolidation-priorities';
import type { MemoryEntry } from './memory-entries';

function makeEntry(
  type: MemoryEntry['type'],
  name: string,
  createdAt?: string,
  content = 'placeholder body for the entry',
): MemoryEntry {
  return {
    type,
    name,
    description: `${name} description`,
    content,
    createdAt,
  };
}

describe('getEntryPriority', () => {
  it('maps user → critical', () => {
    expect(getEntryPriority(makeEntry('user', 'X'))).toBe<EntryPriority>('critical');
  });

  it('maps prohibition → critical', () => {
    expect(getEntryPriority(makeEntry('prohibition', 'X'))).toBe<EntryPriority>('critical');
  });

  it('maps feedback → high', () => {
    expect(getEntryPriority(makeEntry('feedback', 'X'))).toBe<EntryPriority>('high');
  });

  it('maps project → medium', () => {
    expect(getEntryPriority(makeEntry('project', 'X'))).toBe<EntryPriority>('medium');
  });

  it('maps reference → low', () => {
    expect(getEntryPriority(makeEntry('reference', 'X'))).toBe<EntryPriority>('low');
  });
});

describe('sortByPriority', () => {
  it('returns critical entries before lower priorities', () => {
    const entries: MemoryEntry[] = [
      makeEntry('reference', 'R'),
      makeEntry('user', 'U'),
      makeEntry('project', 'P'),
      makeEntry('prohibition', 'PRO'),
      makeEntry('feedback', 'F'),
    ];
    const sorted = sortByPriority(entries);
    const types = sorted.map((e) => e.type);
    // critical (user, prohibition) → high (feedback) → medium (project) → low (reference)
    expect(types.slice(0, 2)).toEqual(expect.arrayContaining(['user', 'prohibition']));
    expect(types[2]).toBe('feedback');
    expect(types[3]).toBe('project');
    expect(types[4]).toBe('reference');
  });

  it('sorts within the same priority by createdAt descending (newer first)', () => {
    const entries: MemoryEntry[] = [
      makeEntry('user', 'old', '2026-01-01T00:00:00Z'),
      makeEntry('user', 'new', '2026-05-01T00:00:00Z'),
      makeEntry('user', 'middle', '2026-03-01T00:00:00Z'),
    ];
    const sorted = sortByPriority(entries).map((e) => e.name);
    expect(sorted).toEqual(['new', 'middle', 'old']);
  });

  it('does not mutate the input array', () => {
    const entries: MemoryEntry[] = [
      makeEntry('reference', 'R'),
      makeEntry('user', 'U'),
    ];
    const snapshot = [...entries];
    sortByPriority(entries);
    expect(entries).toEqual(snapshot);
  });

  it('handles empty input', () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it('places entries with createdAt before those without (within same priority)', () => {
    const entries: MemoryEntry[] = [
      makeEntry('user', 'no-date'),
      makeEntry('user', 'has-date', '2026-05-01T00:00:00Z'),
    ];
    const sorted = sortByPriority(entries).map((e) => e.name);
    expect(sorted).toEqual(['has-date', 'no-date']);
  });
});

describe('trimToFit', () => {
  it('returns [] for empty input', () => {
    expect(trimToFit([], 10, 1000)).toEqual([]);
  });

  it('returns the original entries when they already fit', () => {
    const entries: MemoryEntry[] = [makeEntry('user', 'A'), makeEntry('project', 'B')];
    const out = trimToFit(entries, 200, 25_000);
    expect(out).toHaveLength(2);
  });

  it('drops lowest-priority entries first when over the line limit', () => {
    const entries: MemoryEntry[] = [
      makeEntry('reference', 'low-pri'),
      makeEntry('project', 'mid-pri'),
      makeEntry('user', 'top-pri'),
    ];
    // Each serialized entry takes ~6 lines (frontmatter + content). Limit at 12 lines forces
    // trimming the lowest-priority (reference) entry.
    const out = trimToFit(entries, 12, 25_000);
    const names = out.map((e) => e.name);
    expect(names).toContain('top-pri');
    expect(names).not.toContain('low-pri');
  });

  it('returns [] when the limits cannot fit even the highest-priority entry', () => {
    const entries: MemoryEntry[] = [makeEntry('user', 'unfittable')];
    expect(trimToFit(entries, 1, 10)).toEqual([]);
  });

  it('drops by priority then by age within a priority', () => {
    const entries: MemoryEntry[] = [
      makeEntry('reference', 'newest-low', '2026-05-01T00:00:00Z'),
      makeEntry('reference', 'oldest-low', '2026-01-01T00:00:00Z'),
      makeEntry('user', 'critical', '2026-05-01T00:00:00Z'),
    ];
    // Force enough pressure to drop one reference entry — older one should go.
    const out = trimToFit(entries, 15, 25_000);
    const names = out.map((e) => e.name);
    expect(names).toContain('critical');
    expect(names).toContain('newest-low');
    expect(names).not.toContain('oldest-low');
  });
});
