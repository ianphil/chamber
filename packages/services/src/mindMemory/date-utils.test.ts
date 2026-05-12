import { describe, expect, it } from 'vitest';

import { convertRelativeDates, parseRelativeDate } from './date-utils';

const REF = new Date('2026-05-12T00:00:00Z');

describe('convertRelativeDates', () => {
  it('returns the content untouched when no relative phrases are present', () => {
    expect(convertRelativeDates('nothing relative here', REF)).toBe('nothing relative here');
  });

  it('converts "yesterday" to ref - 1 day', () => {
    expect(convertRelativeDates('met yesterday with team', REF)).toBe(
      'met 2026-05-11 with team',
    );
  });

  it('converts "today" and "this morning" to ref date', () => {
    expect(convertRelativeDates('shipped today', REF)).toBe('shipped 2026-05-12');
    expect(convertRelativeDates('this morning the build broke', REF)).toBe(
      '2026-05-12 the build broke',
    );
  });

  it('converts "last week" to ref - 7 days', () => {
    expect(convertRelativeDates('decided last week', REF)).toBe('decided 2026-05-05');
  });

  it('converts "last month" to ref - 30 days', () => {
    expect(convertRelativeDates('happened last month', REF)).toBe('happened 2026-04-12');
  });

  it('converts "a few days ago" to ref - 3 days', () => {
    expect(convertRelativeDates('a few days ago we shipped', REF)).toBe(
      '2026-05-09 we shipped',
    );
  });

  it('converts "<n> days ago" with the parsed integer offset', () => {
    expect(convertRelativeDates('5 days ago', REF)).toBe('2026-05-07');
    expect(convertRelativeDates('1 day ago', REF)).toBe('2026-05-11');
  });

  it('is case-insensitive for keyword forms', () => {
    expect(convertRelativeDates('YESTERDAY', REF)).toBe('2026-05-11');
    expect(convertRelativeDates('Last Week', REF)).toBe('2026-05-05');
  });

  it('replaces multiple occurrences in one pass', () => {
    expect(convertRelativeDates('today and yesterday', REF)).toBe('2026-05-12 and 2026-05-11');
  });

  it('only matches whole-word boundaries (does not corrupt "yesterdays")', () => {
    expect(convertRelativeDates('yesterdays plans', REF)).toBe('yesterdays plans');
  });
});

describe('convertRelativeDates fix for "a few days ago"', () => {
  // Documented: 3 days before 2026-05-12 == 2026-05-09. The earlier example used
  // 2026-04-12 by mistake. Re-verify with explicit small math here.
  it('"a few days ago" resolves to ref - 3 days exactly', () => {
    const ref = new Date('2026-05-12T00:00:00Z');
    expect(convertRelativeDates('a few days ago', ref)).toBe('2026-05-09');
  });
});

describe('parseRelativeDate', () => {
  it('returns the resolved Date for a single matching phrase', () => {
    const out = parseRelativeDate('yesterday', REF);
    expect(out).not.toBeNull();
    expect(out?.toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  it('returns the resolved Date for "<n> days ago"', () => {
    const out = parseRelativeDate('14 days ago', REF);
    expect(out?.toISOString().slice(0, 10)).toBe('2026-04-28');
  });

  it('returns null when the input is not a recognised relative phrase', () => {
    expect(parseRelativeDate('next thursday', REF)).toBeNull();
    expect(parseRelativeDate('', REF)).toBeNull();
    expect(parseRelativeDate('something else', REF)).toBeNull();
  });

  it('returns null when the input contains the phrase but extra text', () => {
    expect(parseRelativeDate('yesterday at noon', REF)).toBeNull();
  });

  it('trims whitespace before matching', () => {
    expect(parseRelativeDate('  today  ', REF)?.toISOString().slice(0, 10)).toBe('2026-05-12');
  });
});
