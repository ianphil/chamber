const STORAGE_KEY = 'chamber:emoji:recents:v1';
const MAX_RECENTS = 16;

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRecentEmojis(): string[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): string[] {
  if (!emoji) return getRecentEmojis();
  const current = getRecentEmojis();
  const deduped = current.filter((e) => e !== emoji);
  const next = [emoji, ...deduped].slice(0, MAX_RECENTS);
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota exceeded or other failure — ignore, in-memory next is still returned
    }
  }
  return next;
}

export function clearRecentEmojis(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const __emojiRecentsTestExports = { STORAGE_KEY, MAX_RECENTS };
