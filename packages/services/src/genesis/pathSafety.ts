import path from 'node:path';

export function isSafeRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === '.' || (!normalized.startsWith('..') && !normalized.includes('/../'));
}
