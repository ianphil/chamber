import { describe, it, expect } from 'vitest';
import {
  orient,
  gather,
  consolidate,
  prune,
  runConsolidation,
} from './consolidation';
import { serializeMemoryMd } from './memory-entries';
import type { MemoryEntry } from './memory-entries';

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    type: 'project',
    name: 'test-entry',
    description: 'A test entry',
    content: 'Some test content.',
    ...overrides,
  };
}

function buildMd(entries: MemoryEntry[]): string {
  return serializeMemoryMd(entries);
}

const REF_DATE = new Date('2025-06-15');

describe('orient', () => {
  it('parses valid MEMORY.md into correct entries', () => {
    const entries = [
      entry({ name: 'Pref A', type: 'user', description: 'desc A', content: 'content A' }),
      entry({ name: 'Proj B', type: 'project', description: 'desc B', content: 'content B' }),
    ];
    const md = buildMd(entries);
    const result = orient(md);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Pref A');
    expect(result[1]!.name).toBe('Proj B');
  });

  it('empty MEMORY.md → empty array', () => {
    expect(orient('')).toEqual([]);
    expect(orient('   ')).toEqual([]);
  });

  it('malformed MEMORY.md → empty array (graceful)', () => {
    expect(orient('not valid markdown at all')).toEqual([]);
    expect(orient('---\nbroken\n')).toEqual([]);
  });

  it('converts relative dates to absolute', () => {
    const entries = [entry({ name: 'E1', content: 'Discovered yesterday in code review.' })];
    const md = buildMd(entries);
    const result = orient(md, REF_DATE);
    expect(result[0]!.content).toContain('2025-06-14');
    expect(result[0]!.content).not.toContain('yesterday');
  });
});

describe('gather', () => {
  it('valid entries pass through', () => {
    const input: MemoryEntry[] = [entry({ name: 'G1' }), entry({ name: 'G2' })];
    const result = gather(input);
    expect(result).toHaveLength(2);
  });

  it('invalid entries filtered out', () => {
    const input = [
      entry({ name: 'Good' }),
      { type: 'user', name: '', description: '', content: '' } as unknown as MemoryEntry,
    ];
    const result = gather(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Good');
  });

  it('converts relative dates', () => {
    const input = [entry({ name: 'E1', content: 'Added yesterday.' })];
    const result = gather(input, REF_DATE);
    expect(result[0]!.content).toContain('2025-06-14');
  });

  it('empty input → empty output', () => {
    expect(gather([])).toEqual([]);
  });
});

describe('consolidate', () => {
  it('existing + new merged correctly (new entries are newer)', () => {
    const existing = [entry({ name: 'Ex1', content: 'existing' })];
    const gathered = [entry({ name: 'New1', content: 'new thing' })];
    const result = consolidate(existing, gathered);
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('duplicate entries deduplicated (keep newer)', () => {
    const existing = [
      entry({ name: 'DB Info', content: 'Uses PostgreSQL with Supabase for data.' }),
    ];
    const gathered = [
      entry({ name: 'Database Info', content: 'Uses PostgreSQL with Supabase for data!' }),
    ];
    const result = consolidate(existing, gathered);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.name).toBe('Database Info');
    expect(result.deduped).toBeGreaterThanOrEqual(1);
  });

  it('contradicting entries resolved (keep newer)', () => {
    const existing = [entry({ name: 'DB', content: 'Use MySQL' })];
    const gathered = [entry({ name: 'DB', content: 'Use PostgreSQL' })];
    const result = consolidate(existing, gathered);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toBe('Use PostgreSQL');
    expect(result.contradictions).toBeGreaterThanOrEqual(1);
  });

  it('no duplicates → all kept, deduped=0', () => {
    const existing = [entry({ name: 'X', content: 'xxx-distinct' })];
    const gathered = [entry({ name: 'Y', content: 'yyy-different' })];
    const result = consolidate(existing, gathered);
    expect(result.entries).toHaveLength(2);
    expect(result.deduped).toBe(0);
    expect(result.contradictions).toBe(0);
  });

  it('groups entries by type (user before reference)', () => {
    const existing: MemoryEntry[] = [];
    const gathered: MemoryEntry[] = [
      entry({
        type: 'reference',
        name: 'Ref1',
        content: 'A useful reference link.',
        createdAt: '2025-01-01',
      }),
      entry({
        type: 'user',
        name: 'Usr1',
        content: 'User prefers dark mode always.',
        createdAt: '2025-01-01',
      }),
      entry({
        type: 'project',
        name: 'Prj1',
        content: 'Project uses Node.js runtime.',
        createdAt: '2025-01-01',
      }),
    ];
    const result = consolidate(existing, gathered);
    const types = result.entries.map((e) => e.type);
    const userIdx = types.indexOf('user');
    const refIdx = types.indexOf('reference');
    expect(userIdx).toBeLessThan(refIdx);
  });
});

describe('prune', () => {
  it('under limits → no pruning, truncated=false', () => {
    const entries = [entry({ name: 'Small', content: 'tiny.' })];
    const result = prune(entries);
    expect(result.truncated).toBe(false);
    expect(result.entries).toHaveLength(1);
  });

  it('over line limit → entries removed to fit', () => {
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push(
        entry({
          name: `Entry-${i}`,
          type: i < 5 ? 'user' : 'reference',
          content: `Line 1\nLine 2\nLine 3\nLine 4\nLine 5`,
          createdAt: `2025-01-${String(i + 1).padStart(2, '0')}`,
        }),
      );
    }
    const result = prune(entries);
    expect(result.entries.length).toBeLessThan(50);
  });

  it('reference entries dropped before user entries', () => {
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        entry({
          name: `User-${i}`,
          type: 'user',
          content: 'User pref line.',
          createdAt: `2025-06-${String(i + 1).padStart(2, '0')}`,
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      entries.push(
        entry({
          name: `Ref-${i}`,
          type: 'reference',
          content: `Ref line 1\nRef line 2\nRef line 3\nRef line 4`,
          createdAt: `2025-01-${String(i + 1).padStart(2, '0')}`,
        }),
      );
    }
    const result = prune(entries);
    const userCount = result.entries.filter((e) => e.type === 'user').length;
    expect(userCount).toBe(10);
  });

  it('truncation as final safety net', () => {
    const entries: MemoryEntry[] = [
      entry({ name: 'Big-user', type: 'user', content: 'X\n'.repeat(250) }),
    ];
    const result = prune(entries);
    expect(result.truncated).toBe(true);
  });
});

describe('runConsolidation', () => {
  it('full pipeline: existing MEMORY.md + new entries → improved MEMORY.md', () => {
    const existingMd = buildMd([
      entry({ name: 'Existing', type: 'project', content: 'Existing project info.' }),
    ]);
    const newEntries: MemoryEntry[] = [
      entry({ name: 'New Pref', type: 'user', content: 'New user preference.' }),
    ];
    const result = runConsolidation({ currentMemoryMd: existingMd, newEntries });
    expect(result.memoryMd).toContain('Existing');
    expect(result.memoryMd).toContain('New Pref');
    expect(result.entriesProcessed).toBe(2);
    expect(result.entriesKept).toBe(2);
  });

  it('existing with same-name new entry → contradiction resolved (keep newer)', () => {
    const existingMd = buildMd([entry({ name: 'SharedName', content: 'old content' })]);
    const newEntries: MemoryEntry[] = [entry({ name: 'SharedName', content: 'updated content' })];
    const result = runConsolidation({ currentMemoryMd: existingMd, newEntries });
    expect(result.contradictionsResolved).toBeGreaterThanOrEqual(1);
    expect(result.memoryMd).toContain('updated content');
    expect(result.entriesKept).toBe(1);
  });

  it('phase log has correct stats', () => {
    const existingMd = buildMd([entry({ name: 'A', type: 'user', content: 'A content' })]);
    const newEntries: MemoryEntry[] = [entry({ name: 'B', type: 'project', content: 'B content' })];
    const result = runConsolidation({ currentMemoryMd: existingMd, newEntries });
    expect(result.phases.orient.existingEntries).toBe(1);
    expect(result.phases.gather.newEntries).toBe(1);
    expect(result.phases.consolidate.merged).toBe(2);
  });

  it('result fits within limits when overflowing', () => {
    const newEntries: MemoryEntry[] = Array.from({ length: 60 }, (_, i) =>
      entry({
        name: `Entry-${i}`,
        type: 'reference',
        content: `Line 1\nLine 2\nLine 3\nLine 4`,
        createdAt: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      }),
    );
    const result = runConsolidation({ currentMemoryMd: '', newEntries });
    const lines = result.memoryMd.split('\n').length;
    expect(lines).toBeLessThanOrEqual(210);
  });

  it('idempotency: run twice with same input → same output', () => {
    const existingMd = buildMd([
      entry({ name: 'Stable', type: 'user', content: 'Stable content.' }),
    ]);
    const newEntries: MemoryEntry[] = [
      entry({ name: 'New', type: 'project', content: 'New content.' }),
    ];
    const input = { currentMemoryMd: existingMd, newEntries, referenceDate: REF_DATE };
    const result1 = runConsolidation(input);
    const result2 = runConsolidation(input);
    expect(result1.memoryMd).toBe(result2.memoryMd);
    expect(result1.entriesKept).toBe(result2.entriesKept);
  });

  it('referenceDate is used for date conversion', () => {
    const newEntries: MemoryEntry[] = [
      entry({ name: 'DatedEntry', content: 'Found yesterday in the logs.' }),
    ];
    const result = runConsolidation({
      currentMemoryMd: '',
      newEntries,
      referenceDate: REF_DATE,
    });
    expect(result.memoryMd).toContain('2025-06-14');
    expect(result.memoryMd).not.toContain('yesterday');
  });
});
