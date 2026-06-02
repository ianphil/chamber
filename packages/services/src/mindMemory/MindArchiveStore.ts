/**
 * MindArchiveStore — filesystem adapter for `<mindPath>/.working-memory/archive/`.
 *
 * Phase 3 scope (locked by plan): `node:*` only — no Electron, no Chamber
 * Logger, no third-party I/O libs. Errors propagate; callers own logging.
 *
 * Layout:
 *   archive/
 *     consolidated/<ISO-8601-Z>--<turn-id>.md
 *     weekly/<YYYY>-W<NN>.md
 *     monthly/<YYYY>-<MM>.md
 *
 * Same atomic-write and path-traversal guarantees as MindMemoryVault.
 * Archive contents are owned exclusively by this module — they never appear
 * in the vault's `listFiles()` output (the `archive/` subdirectory is filtered
 * there).
 */

import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { resolveRelPath } from './MindMemoryVault';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const ARCHIVE_DIRNAME = 'archive';
const CONSOLIDATED_DIRNAME = 'consolidated';
const WEEKLY_DIRNAME = 'weekly';
const MONTHLY_DIRNAME = 'monthly';

export interface ConsolidatedRecord {
  readonly turnId: string;
  readonly timestamp: string;
  readonly content: string;
}

export interface MindArchiveStore {
  readonly root: string;
  writeConsolidated(record: ConsolidatedRecord): Promise<string>;
  writeWeekly(weekKey: string, content: string): Promise<string>;
  writeMonthly(monthKey: string, content: string): Promise<string>;
  listConsolidated(): Promise<string[]>;
  listWeekly(): Promise<string[]>;
  listMonthly(): Promise<string[]>;
}

export function createMindArchiveStore(mindPath: string): MindArchiveStore {
  const root = path.resolve(mindPath, WORKING_MEMORY_DIRNAME, ARCHIVE_DIRNAME);

  async function writeConsolidated(record: ConsolidatedRecord): Promise<string> {
    assertSafeKey('turnId', record.turnId);
    assertSafeKey('timestamp', record.timestamp);
    // Filenames replace `:` with `-` so the path is portable across Windows
    // (which forbids `:` in NTFS filenames) while keeping the input contract
    // an ISO-8601 UTC timestamp.
    const safeTimestamp = record.timestamp.replace(/:/g, '-');
    const filename = `${safeTimestamp}--${record.turnId}.md`;
    const relPath = path.join(CONSOLIDATED_DIRNAME, filename);
    await writeAtRelPath(root, relPath, record.content);
    return relPath;
  }

  async function writeWeekly(weekKey: string, content: string): Promise<string> {
    assertSafeKey('weekly key', weekKey);
    const relPath = path.join(WEEKLY_DIRNAME, `${weekKey}.md`);
    await writeAtRelPath(root, relPath, content);
    return relPath;
  }

  async function writeMonthly(monthKey: string, content: string): Promise<string> {
    assertSafeKey('monthly key', monthKey);
    const relPath = path.join(MONTHLY_DIRNAME, `${monthKey}.md`);
    await writeAtRelPath(root, relPath, content);
    return relPath;
  }

  function listConsolidated(): Promise<string[]> {
    return listSubdirFiles(path.join(root, CONSOLIDATED_DIRNAME));
  }
  function listWeekly(): Promise<string[]> {
    return listSubdirFiles(path.join(root, WEEKLY_DIRNAME));
  }
  function listMonthly(): Promise<string[]> {
    return listSubdirFiles(path.join(root, MONTHLY_DIRNAME));
  }

  return {
    root,
    writeConsolidated,
    writeWeekly,
    writeMonthly,
    listConsolidated,
    listWeekly,
    listMonthly,
  };
}

function assertSafeKey(label: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid ${label}: must be a non-empty string`);
  }
  if (value.includes('\u0000')) {
    throw new Error(`invalid ${label}: contains NUL byte`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`invalid ${label}: must not contain path separators (got ${value})`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`invalid ${label}: must not be . or ..`);
  }
}

async function writeAtRelPath(root: string, relPath: string, content: string): Promise<void> {
  const abs = resolveRelPath(root, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tempPath = `${abs}.tmp.${randomUUID()}`;
  const handle = await fsp.open(tempPath, 'wx');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tempPath, abs);
  } catch (err) {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

async function listSubdirFiles(absDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    throw err;
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}
