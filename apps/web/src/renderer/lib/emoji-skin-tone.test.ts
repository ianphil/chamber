/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEmojiSkinTone,
  setEmojiSkinTone,
  __emojiSkinToneTestExports,
} from './emoji-skin-tone';

const KEY = __emojiSkinToneTestExports.STORAGE_KEY;

describe('emoji-skin-tone', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns "none" by default', () => {
    expect(getEmojiSkinTone()).toBe('none');
  });

  it('round-trips a valid value', () => {
    setEmojiSkinTone('medium');
    expect(getEmojiSkinTone()).toBe('medium');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(KEY, 'not-a-tone');
    expect(getEmojiSkinTone()).toBe('none');
  });

  it('does not persist invalid values', () => {
    // @ts-expect-error testing runtime guard
    setEmojiSkinTone('purple');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
