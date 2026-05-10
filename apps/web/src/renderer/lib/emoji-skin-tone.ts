export type EmojiSkinTone =
  | 'none'
  | 'light'
  | 'medium-light'
  | 'medium'
  | 'medium-dark'
  | 'dark';

const STORAGE_KEY = 'chamber:emoji:skinTone:v1';
const VALID: ReadonlySet<EmojiSkinTone> = new Set([
  'none',
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
]);

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getEmojiSkinTone(): EmojiSkinTone {
  const storage = safeStorage();
  if (!storage) return 'none';
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return 'none';
    return VALID.has(raw as EmojiSkinTone) ? (raw as EmojiSkinTone) : 'none';
  } catch {
    return 'none';
  }
}

export function setEmojiSkinTone(value: EmojiSkinTone): void {
  const storage = safeStorage();
  if (!storage) return;
  if (!VALID.has(value)) return;
  try {
    storage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

export const __emojiSkinToneTestExports = { STORAGE_KEY };
