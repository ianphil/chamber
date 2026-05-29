import * as fs from 'node:fs';
import * as path from 'node:path';

const AUTOMATION_DIR = path.join('.chamber', 'automation');

export class ScriptPathValidationError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'ScriptPathValidationError';
  }
}

/**
 * Validates that `scriptPath` (mind-relative) names an automation script
 * safe to spawn:
 *  - relative (no absolute paths)
 *  - no `..` traversal segments
 *  - lives under `.chamber/automation/`
 *  - ends `.ts`
 *  - exists on disk
 *  - `realpath` does not escape the mind root (defeats symlink escape)
 *
 * Returns the absolute realpath. Callers MUST spawn the returned path,
 * never the input string — single resolution point.
 */
export function validateScriptPath(mindPath: string, scriptPath: string): string {
  if (typeof scriptPath !== 'string' || scriptPath.trim() === '') {
    throw new ScriptPathValidationError('empty', 'Script path must be a non-empty string');
  }
  if (path.isAbsolute(scriptPath)) {
    throw new ScriptPathValidationError('absolute', `Script path must be mind-relative, got absolute: ${scriptPath}`);
  }
  // Reject both POSIX and Windows traversal patterns regardless of platform.
  const segmentsPosix = scriptPath.split(/[\\/]/);
  if (segmentsPosix.some((segment) => segment === '..')) {
    throw new ScriptPathValidationError('traversal', `Script path must not contain '..' segments: ${scriptPath}`);
  }
  if (!scriptPath.endsWith('.ts')) {
    throw new ScriptPathValidationError('extension', `Script path must end with .ts: ${scriptPath}`);
  }
  const normalized = path.normalize(scriptPath);
  // Ensure it starts with `.chamber/automation/` (cross-platform separator).
  const expectedPrefix = AUTOMATION_DIR + path.sep;
  if (!normalized.startsWith(expectedPrefix) && normalized !== AUTOMATION_DIR) {
    throw new ScriptPathValidationError(
      'outside-automation',
      `Script path must live under ${AUTOMATION_DIR}/: ${scriptPath}`,
    );
  }

  const joined = path.join(mindPath, normalized);
  if (!fs.existsSync(joined)) {
    throw new ScriptPathValidationError('missing', `Script does not exist: ${joined}`);
  }
  const resolvedScript = fs.realpathSync(joined);
  const resolvedMindRoot = fs.realpathSync(mindPath);
  const relativeFromRoot = path.relative(resolvedMindRoot, resolvedScript);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new ScriptPathValidationError(
      'symlink-escape',
      `Script realpath escapes mind root: ${resolvedScript}`,
    );
  }
  return resolvedScript;
}
