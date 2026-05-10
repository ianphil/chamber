/**
 * Canonical app-owned emoji dataset.
 *
 * Backs the `:shortcode` inline autocomplete. Frimousse loads its own data
 * via a fetch interceptor (see installFrimousseDataInterceptor). Both rely
 * on the same `emojibase-data` package so they stay version-consistent.
 */

export interface EmojiRecord {
  emoji: string;
  label: string;
  shortcodes: string[];
  tags: string[];
  hexcode: string;
}

export interface EmojiDataset {
  records: EmojiRecord[];
  byShortcode: Map<string, EmojiRecord>;
  search(query: string, limit?: number): EmojiRecord[];
}

interface CompactEmoji {
  hexcode: string;
  unicode: string;
  label: string;
  tags?: string[];
  skins?: CompactEmoji[];
}

let datasetPromise: Promise<EmojiDataset> | null = null;

function buildDataset(
  compact: CompactEmoji[],
  shortcodeMap: Record<string, string | string[]>,
): EmojiDataset {
  const records: EmojiRecord[] = [];
  const byShortcode = new Map<string, EmojiRecord>();

  for (const c of compact) {
    const sc = shortcodeMap[c.hexcode];
    const shortcodes = sc ? (Array.isArray(sc) ? sc : [sc]) : [];
    if (shortcodes.length === 0) continue;
    const rec: EmojiRecord = {
      emoji: c.unicode,
      label: c.label,
      shortcodes,
      tags: c.tags ?? [],
      hexcode: c.hexcode,
    };
    records.push(rec);
    for (const code of shortcodes) {
      const key = code.toLowerCase();
      if (!byShortcode.has(key)) byShortcode.set(key, rec);
    }
  }

  function search(rawQuery: string, limit = 25): EmojiRecord[] {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const exact: EmojiRecord[] = [];
    const prefix: EmojiRecord[] = [];
    const tag: EmojiRecord[] = [];
    const seen = new Set<string>();
    for (const rec of records) {
      if (seen.has(rec.hexcode)) continue;
      const exactHit = rec.shortcodes.some((s) => s.toLowerCase() === q);
      const prefixHit =
        !exactHit &&
        (rec.shortcodes.some((s) => s.toLowerCase().startsWith(q)) ||
          rec.label.toLowerCase().startsWith(q));
      const tagHit =
        !exactHit &&
        !prefixHit &&
        (rec.tags.some((t) => t.toLowerCase().includes(q)) ||
          rec.label.toLowerCase().includes(q));
      if (exactHit) {
        exact.push(rec);
        seen.add(rec.hexcode);
      } else if (prefixHit) {
        prefix.push(rec);
        seen.add(rec.hexcode);
      } else if (tagHit) {
        tag.push(rec);
        seen.add(rec.hexcode);
      }
      if (exact.length + prefix.length + tag.length >= limit * 2) break;
    }
    return [...exact, ...prefix, ...tag].slice(0, limit);
  }

  return { records, byShortcode, search };
}

export function loadEmojiData(): Promise<EmojiDataset> {
  if (datasetPromise) return datasetPromise;
  datasetPromise = (async () => {
    const [compactMod, shortcodeMod] = await Promise.all([
      import('emojibase-data/en/compact.json'),
      import('emojibase-data/en/shortcodes/iamcal.json'),
    ]);
    const compact = (compactMod as { default: CompactEmoji[] }).default ?? compactMod;
    const shortcodes = (shortcodeMod as { default: Record<string, string | string[]> })
      .default ?? shortcodeMod;
    return buildDataset(compact as CompactEmoji[], shortcodes as Record<string, string | string[]>);
  })();
  return datasetPromise;
}

// ---------------------------------------------------------------------------
// Frimousse offline data interceptor.
//
// Frimousse fetches `${emojibaseUrl}/${locale}/data.json` and
// `${emojibaseUrl}/${locale}/messages.json`. To keep the picker fully offline
// in packaged Electron, we register a sentinel URL and shim `window.fetch` to
// resolve those requests from the bundled `emojibase-data` package.
// ---------------------------------------------------------------------------

export const FRIMOUSSE_OFFLINE_URL = 'https://chamber.local/__emoji_cdn__';

const cache = new Map<string, unknown>();

async function loadFrimousseAsset(locale: string, file: string): Promise<unknown> {
  const key = `${locale}/${file}`;
  if (cache.has(key)) return cache.get(key);
  if (locale !== 'en') {
    throw new Error(`unsupported locale: ${locale}`);
  }
  let mod: { default: unknown };
  if (file === 'data') {
    mod = (await import('emojibase-data/en/data.json')) as { default: unknown };
  } else if (file === 'messages') {
    mod = (await import('emojibase-data/en/messages.json')) as { default: unknown };
  } else {
    throw new Error(`unsupported frimousse asset: ${file}`);
  }
  cache.set(key, mod.default ?? mod);
  return cache.get(key);
}

let interceptorInstalled = false;

export function installFrimousseDataInterceptor(): void {
  if (interceptorInstalled) return;
  if (typeof window === 'undefined') return;
  const orig = window.fetch.bind(window);
  const shim = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(FRIMOUSSE_OFFLINE_URL)) {
      const path = url.slice(FRIMOUSSE_OFFLINE_URL.length).replace(/^\//, '');
      const match = /^([a-z-]+)\/(data|messages)\.json$/i.exec(path);
      if (!match) {
        return new Response('not found', { status: 404 });
      }
      const [, locale, file] = match;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'HEAD') {
        return new Response(null, { status: 200 });
      }
      try {
        const data = await loadFrimousseAsset(locale, file);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(String(err), { status: 500 });
      }
    }
    return orig(input, init);
  };
  window.fetch = shim;
  // Frimousse may also reach for globalThis.fetch directly.
  (globalThis as unknown as { fetch: typeof shim }).fetch = shim;
  interceptorInstalled = true;
}

// Test-only resets.
export const __emojiDataTestExports = {
  reset(): void {
    datasetPromise = null;
    cache.clear();
    interceptorInstalled = false;
  },
};
