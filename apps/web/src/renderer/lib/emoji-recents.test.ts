/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRecentEmojis,
  pushRecentEmoji,
  clearRecentEmojis,
  __emojiRecentsTestExports,
} from './emoji-recents';

const KEY = __emojiRecentsTestExports.STORAGE_KEY;

describe('emoji-recents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] when storage is empty', () => {
    expect(getRecentEmojis()).toEqual([]);
  });

  it('push stores and returns the emoji', () => {
    const next = pushRecentEmoji('😀');
    expect(next).toEqual(['😀']);
    expect(getRecentEmojis()).toEqual(['😀']);
  });

  it('push dedupes and moves to front', () => {
    pushRecentEmoji('😀');
    pushRecentEmoji('🎉');
    pushRecentEmoji('😀');
    expect(getRecentEmojis()).toEqual(['😀', '🎉']);
  });

  it('caps at MAX_RECENTS', () => {
    for (let i = 0; i < 25; i++) pushRecentEmoji(String.fromCodePoint(0x1f600 + i));
    expect(getRecentEmojis().length).toBe(__emojiRecentsTestExports.MAX_RECENTS);
  });

  it('returns [] on malformed JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getRecentEmojis()).toEqual([]);
  });

  it('returns [] when stored value is not an array', () => {
    localStorage.setItem(KEY, '"oops"');
    expect(getRecentEmojis()).toEqual([]);
  });

  it('filters non-string entries defensively', () => {
    localStorage.setItem(KEY, JSON.stringify(['😀', 42, null, '🎉']));
    expect(getRecentEmojis()).toEqual(['😀', '🎉']);
  });

  it('push ignores empty string', () => {
    pushRecentEmoji('');
    expect(getRecentEmojis()).toEqual([]);
  });

  it('clear removes the entry', () => {
    pushRecentEmoji('😀');
    clearRecentEmojis();
    expect(getRecentEmojis()).toEqual([]);
  });

  it('survives setItem throwing (quota exceeded)', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      const next = pushRecentEmoji('😀');
      expect(next).toEqual(['😀']);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
