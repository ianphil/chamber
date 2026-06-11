import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Fixed, Chamber-owned location for an onboarding document inside a mind. It is
 * non-destructive (templates do not ship this file) and namespaced under
 * `.chamber/`, consistent with other Chamber-managed mind artifacts such as
 * `.chamber/avatar.png`.
 */
export const ONBOARDING_DOCUMENT_RELATIVE_PATH = path.join('.chamber', 'soul-code.md');

const MAX_SEED_BYTES = 256_000;

/**
 * Writes an onboarding document (e.g. a generated Soul Code) into a mind
 * directory at the fixed `ONBOARDING_DOCUMENT_RELATIVE_PATH`.
 *
 * The destination is owned by Chamber, not the caller: callers supply only the
 * content, so there is no path-traversal surface. The escape and symlink checks
 * below are defense in depth, mirroring `MindProfileService`. The write is
 * atomic (temp file + rename).
 */
export function seedOnboardingDocument(mindPath: string, content: string): void {
  if (!content.trim()) {
    throw new Error('Onboarding document is empty.');
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_SEED_BYTES) {
    throw new Error('Onboarding document is too large to seed.');
  }

  const root = path.resolve(mindPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('Mind directory does not exist.');
  }

  const target = path.resolve(root, ONBOARDING_DOCUMENT_RELATIVE_PATH);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Onboarding document path escapes the mind directory.');
  }
  assertNoSymlinkTraversal(root, target);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, target);
  } catch (error) {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function assertNoSymlinkTraversal(root: string, target: string): void {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Onboarding document path cannot traverse a symlink.');
    }
  }
}
