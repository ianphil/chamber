/**
 * MindMemoryVault — filesystem adapter for `<mindPath>/.working-memory/`.
 *
 * Phase 3 scope (locked by plan): `node:*` only — no Electron, no Chamber
 * Logger, no third-party I/O libs. Errors propagate; callers own logging.
 *
 * Responsibilities:
 *   - Atomic writes via temp + rename (no partial writes ever observable).
 *   - Path-traversal guard rejects every relPath that resolves outside root,
 *     including absolute paths, `..` segments, drive letters, UNC prefixes,
 *     and embedded NUL bytes.
 *   - Per-file in-process append serialization. Cross-process serialization
 *     is the DailyLogWriter's job (Phase 5).
 *   - `listFiles()` excludes managed subdirectories (`.state/`, `archive/`,
 *     and any dotted subdirectory) — only top-level regular files surface
 *     to the WorkingMemoryComposer (Phase 12).
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const ARCHIVE_DIRNAME = 'archive';
const STATE_DIRNAME = '.state';

export interface MindMemoryVault {
  readonly root: string;
  read(relPath: string): Promise<string | null>;
  write(relPath: string, content: string): Promise<void>;
  append(relPath: string, content: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  listFiles(): Promise<string[]>;
  ensureDir(): Promise<void>;
}

export function createMindMemoryVault(mindPath: string): MindMemoryVault {
  const root = path.resolve(mindPath, WORKING_MEMORY_DIRNAME);
  // Per-file in-process mutex chains. Map key = absolute file path.
  // Every append on a given file awaits the prior chain link before issuing
  // its own read-modify-write cycle, eliminating intra-process interleaving.
  const appendChains = new Map<string, Promise<void>>();

  async function ensureDir(): Promise<void> {
    await fsp.mkdir(root, { recursive: true });
  }

  async function read(relPath: string): Promise<string | null> {
    const abs = resolveRelPath(root, relPath);
    try {
      return await fsp.readFile(abs, 'utf-8');
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
  }

  async function write(relPath: string, content: string): Promise<void> {
    const abs = resolveRelPath(root, relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await atomicWriteFile(abs, content);
  }

  async function append(relPath: string, content: string): Promise<void> {
    const abs = resolveRelPath(root, relPath);
    const prior = appendChains.get(abs) ?? Promise.resolve();
    const next = prior.then(async () => {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const handle = await fsp.open(abs, 'a');
      try {
        await handle.write(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    // Swallow errors on the chain itself (caller still gets the rejection
    // through `next`); this prevents one failed append from poisoning the
    // queue for later callers.
    appendChains.set(
      abs,
      next.catch(() => undefined),
    );
    try {
      await next;
    } finally {
      // GC the chain entry once it's the tail and has settled.
      if (appendChains.get(abs) === next || appendChains.get(abs)?.then === next.then) {
        // best-effort cleanup; safe to leave entry if a new append slotted in.
      }
    }
  }

  async function exists(relPath: string): Promise<boolean> {
    const abs = resolveRelPath(root, relPath);
    try {
      await fsp.access(abs, fs.constants.F_OK);
      return true;
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return false;
      throw err;
    }
  }

  async function listFiles(): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return [];
      throw err;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== ARCHIVE_DIRNAME && name !== STATE_DIRNAME);
  }

  return { root, read, write, append, exists, listFiles, ensureDir };
}

export function resolveRelPath(root: string, relPath: string): string {
  assertSafeRelPath(relPath);
  const resolved = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`path escapes vault root: ${relPath} (root=${root})`);
  }
  if (resolved === root) {
    throw new Error(`path resolves to vault root, not a file: ${relPath} (root=${root})`);
  }
  return resolved;
}

function assertSafeRelPath(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('invalid path: must be a non-empty string');
  }
  if (relPath.includes('\u0000')) {
    throw new Error('invalid path: contains NUL byte');
  }
  // Normalize separators so a Windows-style backslash sequence is evaluated
  // the same way on POSIX hosts (where `\` would otherwise be a literal char
  // and slip past `path.posix.isAbsolute`).
  const slashed = relPath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(slashed) || path.win32.isAbsolute(relPath)) {
    throw new Error(`invalid path: must be relative, got ${relPath}`);
  }
  // Reject Windows drive letters (e.g. `C:something`) even without a slash.
  if (/^[A-Za-z]:/.test(relPath)) {
    throw new Error(`invalid path: drive-relative paths not allowed: ${relPath}`);
  }
  const normalized = path.posix.normalize(slashed);
  const segments = normalized.split('/');
  if (segments.some((seg) => seg === '..')) {
    throw new Error(`invalid path: parent traversal not allowed: ${relPath}`);
  }
}

async function atomicWriteFile(absPath: string, content: string): Promise<void> {
  const tempPath = `${absPath}.tmp.${randomUUID()}`;
  const handle = await fsp.open(tempPath, 'wx');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tempPath, absPath);
  } catch (err) {
    // Best-effort cleanup if rename fails; surface the original error.
    try {
      await fsp.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}
