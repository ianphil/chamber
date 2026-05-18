import { describe, it, expect } from 'vitest';
import { escapeXml } from './escapeXml';

describe('escapeXml', () => {
  it('escapes ampersand to &amp;', () => {
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than to &lt;', () => {
    expect(escapeXml('a<b')).toBe('a&lt;b');
  });

  it('escapes greater-than to &gt;', () => {
    expect(escapeXml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quote to &quot;', () => {
    expect(escapeXml('a"b')).toBe('a&quot;b');
  });

  it('escapes single quote to &apos;', () => {
    expect(escapeXml("a'b")).toBe('a&apos;b');
  });

  it('returns empty string for empty input', () => {
    expect(escapeXml('')).toBe('');
  });

  it('returns the original string when nothing needs escaping', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });

  it('escapes every occurrence of a repeated character', () => {
    expect(escapeXml('a&b&c&d')).toBe('a&amp;b&amp;c&amp;d');
  });

  it('escapes a mix of all five characters in a single pass', () => {
    expect(escapeXml(`<tag attr="x" id='y'>a&b</tag>`)).toBe(
      '&lt;tag attr=&quot;x&quot; id=&apos;y&apos;&gt;a&amp;b&lt;/tag&gt;',
    );
  });
});
