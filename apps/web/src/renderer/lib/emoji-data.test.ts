/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadEmojiData,
  installFrimousseDataInterceptor,
  FRIMOUSSE_OFFLINE_URL,
  __emojiDataTestExports,
} from './emoji-data';

describe('loadEmojiData', () => {
  beforeEach(() => {
    __emojiDataTestExports.reset();
  });

  it('returns a dataset with records and byShortcode', async () => {
    const ds = await loadEmojiData();
    expect(ds.records.length).toBeGreaterThan(500);
    expect(ds.byShortcode.size).toBeGreaterThan(500);
  });

  it('byShortcode resolves :smile to a smile emoji', async () => {
    const ds = await loadEmojiData();
    const rec = ds.byShortcode.get('smile');
    expect(rec).toBeTruthy();
    expect(rec?.emoji).toBeTruthy();
    expect(rec?.shortcodes).toContain('smile');
  });

  it('search ranks exact shortcode hits first', async () => {
    const ds = await loadEmojiData();
    const results = ds.search('smile', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].shortcodes.map((s) => s.toLowerCase())).toContain('smile');
  });

  it('search returns [] for empty query', async () => {
    const ds = await loadEmojiData();
    expect(ds.search('')).toEqual([]);
  });

  it('search respects limit', async () => {
    const ds = await loadEmojiData();
    expect(ds.search('a', 3).length).toBeLessThanOrEqual(3);
  });

  it('is idempotent (single load)', async () => {
    const a = await loadEmojiData();
    const b = await loadEmojiData();
    expect(a).toBe(b);
  });
});

describe('installFrimousseDataInterceptor', () => {
  beforeEach(() => {
    __emojiDataTestExports.reset();
  });

  it('serves data.json for the offline URL', async () => {
    installFrimousseDataInterceptor();
    const res = await fetch(`${FRIMOUSSE_OFFLINE_URL}/en/data.json`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(500);
  });

  it('serves messages.json for the offline URL', async () => {
    installFrimousseDataInterceptor();
    const res = await fetch(`${FRIMOUSSE_OFFLINE_URL}/en/messages.json`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('groups');
  });

  it('returns 200 for HEAD requests without a body', async () => {
    installFrimousseDataInterceptor();
    const res = await fetch(`${FRIMOUSSE_OFFLINE_URL}/en/data.json`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for unsupported paths under the sentinel', async () => {
    installFrimousseDataInterceptor();
    const res = await fetch(`${FRIMOUSSE_OFFLINE_URL}/en/bogus.json`);
    expect(res.status).toBe(404);
  });

  it('is idempotent', () => {
    installFrimousseDataInterceptor();
    const first = window.fetch;
    installFrimousseDataInterceptor();
    expect(window.fetch).toBe(first);
  });
});
