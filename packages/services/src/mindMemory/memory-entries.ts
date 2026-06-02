/**
 * Memory entry types, parsing, deduplication, and validation.
 *
 * Pure module: no I/O, no logging.
 *
 * Zod v4 audit: this module uses `z.object`, `z.string()`, `z.string().min(1)`,
 * `z.string().optional()`, `z.enum([...] as const)`, and only the `.success` field
 * of `safeParse(...)`. All of these are stable across zod v3→v4. The `.error.issues`
 * shape changed in v4 but is not consumed here.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const MEMORY_ENTRY_TYPES = ['user', 'feedback', 'project', 'reference', 'prohibition'] as const;

export interface MemoryEntry {
  readonly id?: string;
  readonly type: (typeof MEMORY_ENTRY_TYPES)[number];
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly source?: string;
  readonly createdAt?: string;
}

const MemoryEntrySchema = z.object({
  id: z.string().optional(),
  type: z.enum(MEMORY_ENTRY_TYPES),
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string(),
  source: z.string().optional(),
  createdAt: z.string().optional(),
});

export function validateMemoryEntry(entry: unknown): entry is MemoryEntry {
  return MemoryEntrySchema.safeParse(entry).success;
}

export function parseMemoryMd(content: string): MemoryEntry[] {
  if (!content.trim()) return [];

  const entries: MemoryEntry[] = [];
  const blocks = splitIntoBlocks(content);

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

function splitIntoBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /---\n([\s\S]*?)---\n([\s\S]*?)(?=\n---\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const frontmatter = match[1]!;
    const body = match[2]!;
    blocks.push(`---\n${frontmatter}---\n${body}`);
  }

  return blocks;
}

function parseBlock(block: string): MemoryEntry | null {
  const fmMatch = /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(block.trim());
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1]!;
  const content = fmMatch[2]!.trim();

  const fields = parseSimpleYaml(frontmatter);
  if (!fields.name || !fields.description || !fields.type) return null;

  const entry: Record<string, string> = {
    type: fields.type,
    name: fields.name,
    description: fields.description,
    content,
  };

  if (fields.id) entry['id'] = fields.id;
  if (fields.source) entry['source'] = fields.source;
  if (fields.createdAt) entry['createdAt'] = fields.createdAt;

  return validateMemoryEntry(entry) ? (entry as unknown as MemoryEntry) : null;
}

function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function serializeMemoryMd(entries: ReadonlyArray<MemoryEntry>): string {
  return entries.map(serializeEntry).join('\n\n');
}

function serializeEntry(entry: MemoryEntry): string {
  const fields: string[] = [];

  if (entry.id) fields.push(`id: ${entry.id}`);
  fields.push(`name: ${entry.name}`);
  fields.push(`description: ${entry.description}`);
  fields.push(`type: ${entry.type}`);

  if (entry.source) fields.push(`source: ${entry.source}`);
  if (entry.createdAt) fields.push(`createdAt: ${entry.createdAt}`);

  return `---\n${fields.join('\n')}\n---\n${entry.content}`;
}

export function detectDuplicates(
  entries: ReadonlyArray<MemoryEntry>,
): ReadonlyArray<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;

      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        pairs.push([i, j] as const);
        continue;
      }

      if (contentSimilarity(a.content, b.content) > 0.8) {
        pairs.push([i, j] as const);
      }
    }
  }

  return pairs;
}

function contentSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }

  return matches / longer.length;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function deduplicateEntries(
  entries: ReadonlyArray<MemoryEntry>,
): ReadonlyArray<MemoryEntry> {
  const dupes = detectDuplicates(entries);
  const removeSet = new Set<number>();

  for (const [earlier] of dupes) {
    removeSet.add(earlier);
  }

  return entries.filter((_, i) => !removeSet.has(i));
}

export function resolveContradictions(
  entries: ReadonlyArray<MemoryEntry>,
): ReadonlyArray<MemoryEntry> {
  const removeSet = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;

      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        removeSet.add(i);
        continue;
      }

      if (a.type === b.type && nameSimilarity(a.name, b.name) > 0.8) {
        removeSet.add(i);
      }
    }
  }

  return entries.filter((_, i) => !removeSet.has(i));
}

function nameSimilarity(a: string, b: string): number {
  return contentSimilarity(a, b);
}

export function resynthesizeMemoryEntries(
  entries: ReadonlyArray<MemoryEntry>,
  synthesize: (
    content: string,
    type: MemoryEntry['type'],
  ) => { name: string; description: string; content: string } | null,
  fixTyposFn: (text: string) => string,
): MemoryEntry[] {
  const results: MemoryEntry[] = [];
  for (const entry of entries) {
    const synthesized = synthesize(entry.content, entry.type);
    if (synthesized) {
      results.push({
        ...entry,
        id: entry.id ?? randomUUID(),
        name: synthesized.name,
        description: synthesized.description,
        content: synthesized.content,
      });
    } else {
      results.push({
        ...entry,
        id: entry.id ?? randomUUID(),
        name: fixTyposFn(entry.name),
        description: fixTyposFn(entry.description),
        content: fixTyposFn(entry.content),
      });
    }
  }
  return results;
}
