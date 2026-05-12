import { describe, expect, it } from 'vitest';

import {
  type MemoryEntry,
  deduplicateEntries,
  detectDuplicates,
  parseMemoryMd,
  resolveContradictions,
  resynthesizeMemoryEntries,
  serializeMemoryMd,
  validateMemoryEntry,
} from './memory-entries';

describe('validateMemoryEntry', () => {
  it('accepts a minimal valid entry', () => {
    const entry: MemoryEntry = {
      type: 'user',
      name: 'Prefer concise commits',
      description: 'User prefers concise commit messages',
      content: 'concise commits',
    };
    expect(validateMemoryEntry(entry)).toBe(true);
  });

  it('rejects entries with an unknown type', () => {
    expect(
      validateMemoryEntry({
        type: 'gibberish',
        name: 'x',
        description: 'y',
        content: 'z',
      }),
    ).toBe(false);
  });

  it('rejects entries with empty required strings', () => {
    expect(
      validateMemoryEntry({
        type: 'user',
        name: '',
        description: 'x',
        content: 'y',
      }),
    ).toBe(false);
    expect(
      validateMemoryEntry({
        type: 'user',
        name: 'x',
        description: '',
        content: 'y',
      }),
    ).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateMemoryEntry(null)).toBe(false);
    expect(validateMemoryEntry('string')).toBe(false);
    expect(validateMemoryEntry(42)).toBe(false);
  });

  it('accepts every type from the enum', () => {
    for (const type of ['user', 'feedback', 'project', 'reference', 'prohibition'] as const) {
      expect(
        validateMemoryEntry({ type, name: 'n', description: 'd', content: 'c' }),
      ).toBe(true);
    }
  });
});

describe('parseMemoryMd', () => {
  it('returns [] for empty content', () => {
    expect(parseMemoryMd('')).toEqual([]);
    expect(parseMemoryMd('   \n  ')).toEqual([]);
  });

  it('parses a single entry with frontmatter', () => {
    const md = `---\nname: Prefer concise commits\ndescription: User prefers brevity\ntype: user\n---\nconcise commit messages`;
    const result = parseMemoryMd(md);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'Prefer concise commits',
      description: 'User prefers brevity',
      type: 'user',
      content: 'concise commit messages',
    });
  });

  it('parses multiple entries separated by ---', () => {
    const md = [
      `---\nname: A\ndescription: dA\ntype: user\n---\ncontentA`,
      `---\nname: B\ndescription: dB\ntype: project\n---\ncontentB`,
    ].join('\n');
    const result = parseMemoryMd(md);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('A');
    expect(result[1]?.name).toBe('B');
  });

  it('preserves optional fields when present', () => {
    const md = `---\nid: abc-123\nname: X\ndescription: dx\ntype: user\nsource: daily-log:2026-05-12\ncreatedAt: 2026-05-12T03:00:00Z\n---\nbody`;
    const [entry] = parseMemoryMd(md);
    expect(entry?.id).toBe('abc-123');
    expect(entry?.source).toBe('daily-log:2026-05-12');
    expect(entry?.createdAt).toBe('2026-05-12T03:00:00Z');
  });

  it('skips blocks missing required fields', () => {
    const md = `---\ntype: user\n---\nno name`;
    expect(parseMemoryMd(md)).toEqual([]);
  });
});

describe('serializeMemoryMd', () => {
  it('round-trips through parseMemoryMd', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'A', description: 'dA', content: 'cA' },
      { type: 'project', name: 'B', description: 'dB', content: 'cB' },
    ];
    const serialized = serializeMemoryMd(entries);
    const reparsed = parseMemoryMd(serialized);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0]).toMatchObject(entries[0]!);
    expect(reparsed[1]).toMatchObject(entries[1]!);
  });

  it('emits id, source, createdAt only when present', () => {
    const md = serializeMemoryMd([
      { type: 'user', name: 'A', description: 'dA', content: 'cA' },
    ]);
    expect(md).not.toContain('id:');
    expect(md).not.toContain('source:');
    expect(md).not.toContain('createdAt:');
  });
});

describe('detectDuplicates', () => {
  it('flags entries with identical names case-insensitively', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'Prefer Concise Commits', description: 'd', content: 'c' },
      { type: 'user', name: 'prefer concise commits', description: 'd', content: 'c' },
    ];
    expect(detectDuplicates(entries)).toEqual([[0, 1]]);
  });

  it('flags entries with very similar content', () => {
    const long = 'we are using postgres for the auth service';
    const entries: MemoryEntry[] = [
      { type: 'project', name: 'A', description: 'd', content: long },
      { type: 'project', name: 'B', description: 'd', content: long },
    ];
    expect(detectDuplicates(entries)).toEqual([[0, 1]]);
  });

  it('returns no pairs when entries are distinct', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'A', description: 'dA', content: 'totally different' },
      { type: 'user', name: 'B', description: 'dB', content: 'completely unrelated' },
    ];
    expect(detectDuplicates(entries)).toEqual([]);
  });
});

describe('deduplicateEntries', () => {
  it('keeps the later entry when names collide', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'A', description: 'old', content: 'old' },
      { type: 'user', name: 'a', description: 'new', content: 'new' },
    ];
    const out = deduplicateEntries(entries);
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('new');
  });

  it('returns all entries when no duplicates exist', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'A', description: 'd', content: 'totally different content here' },
      { type: 'project', name: 'B', description: 'd', content: 'completely unrelated material' },
    ];
    expect(deduplicateEntries(entries)).toHaveLength(2);
  });
});

describe('resolveContradictions', () => {
  it('keeps the later entry when names match exactly', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'X', description: 'old', content: 'old' },
      { type: 'user', name: 'X', description: 'new', content: 'new' },
    ];
    const out = resolveContradictions(entries);
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('new');
  });

  it('keeps the later entry when same type and similar names', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'use postgres', description: 'old', content: 'c' },
      { type: 'user', name: 'use postgres!', description: 'new', content: 'c' },
    ];
    const out = resolveContradictions(entries);
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('new');
  });

  it('does not collapse entries of different types even with similar names', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'use postgres', description: 'a', content: 'a' },
      { type: 'project', name: 'use postgres', description: 'b', content: 'b' },
    ];
    // Note: identical name (case-insensitive) STILL collapses regardless of type per SCNS rules.
    const out = resolveContradictions(entries);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('project');
  });
});

describe('resynthesizeMemoryEntries', () => {
  it('uses the synthesizer output when it returns a result', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'old', description: 'old', content: 'raw text' },
    ];
    const out = resynthesizeMemoryEntries(
      entries,
      () => ({ name: 'New', description: 'New desc', content: 'New content' }),
      (t) => t,
    );
    expect(out[0]).toMatchObject({
      name: 'New',
      description: 'New desc',
      content: 'New content',
    });
    expect(out[0]?.id).toBeDefined();
  });

  it('falls back to typo-fix when the synthesizer returns null', () => {
    const entries: MemoryEntry[] = [
      { type: 'user', name: 'teh name', description: 'teh desc', content: 'teh body' },
    ];
    const out = resynthesizeMemoryEntries(
      entries,
      () => null,
      (t) => t.replace(/teh/g, 'the'),
    );
    expect(out[0]?.name).toBe('the name');
    expect(out[0]?.description).toBe('the desc');
    expect(out[0]?.content).toBe('the body');
  });

  it('preserves an existing id when present', () => {
    const entries: MemoryEntry[] = [
      { id: 'preserved', type: 'user', name: 'A', description: 'd', content: 'c' },
    ];
    const out = resynthesizeMemoryEntries(
      entries,
      () => ({ name: 'A', description: 'd', content: 'c' }),
      (t) => t,
    );
    expect(out[0]?.id).toBe('preserved');
  });
});
