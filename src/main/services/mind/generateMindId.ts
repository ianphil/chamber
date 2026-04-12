import * as path from 'path';
import * as crypto from 'crypto';

/** Generate a stable, human-readable mind ID from a directory path. */
export function generateMindId(mindPath: string): string {
  const basename = path.basename(mindPath);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${basename}-${suffix}`;
}
