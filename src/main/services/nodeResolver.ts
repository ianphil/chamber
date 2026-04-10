// Shared utility to locate system Node.js binary (outside Electron's bundled runtime).

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const isWindows = process.platform === 'win32';

/**
 * Find system Node.js. Returns the path or null if not found.
 * Checks PATH first, then well-known install locations.
 */
export function findSystemNode(): string | null {
  if (isWindows) {
    try {
      const result = execSync('where.exe node', { encoding: 'utf-8', timeout: 3000 }).trim();
      const firstLine = result.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) return firstLine;
    } catch { /* not on PATH */ }

    const candidates = [
      path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'fnm_multishells', 'node.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } else {
    try {
      const result = execSync('which node', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (result && fs.existsSync(result)) return result;
    } catch { /* not found */ }
  }
  return null;
}

/**
 * Find system Node.js or throw. Use when Node is required.
 */
export function requireSystemNode(reason: string): string {
  const node = findSystemNode();
  if (!node) throw new Error(`System Node.js not found — required for ${reason}`);
  return node;
}
