import { describe, it, expect } from 'vitest';
import { cn, generateId, formatTime, formatDisplayValue, parseSkillContextInjection } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('deduplicates tailwind conflicts', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('');
  });
});

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('contains a timestamp prefix and random suffix', () => {
    const id = generateId();
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });
});

describe('formatTime', () => {
  it('returns a formatted time string', () => {
    const result = formatTime(Date.now());
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats a known timestamp consistently', () => {
    // Use a fixed timestamp: 2026-01-15T14:30:00Z
    const ts = new Date('2026-01-15T14:30:00Z').getTime();
    const result = formatTime(ts);
    // Should contain hour and minute separated by colon
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDisplayValue', () => {
  it('joins arrays with commas', () => {
    expect(formatDisplayValue(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('stringifies plain objects', () => {
    expect(formatDisplayValue({ a: 1 })).toBe('{"a":1}');
  });

  it('renders a dash for null and undefined', () => {
    expect(formatDisplayValue(null)).toBe('--');
    expect(formatDisplayValue(undefined)).toBe('--');
  });

  it('humanizes an ISO datetime string with a timezone offset', () => {
    const result = formatDisplayValue('2026-06-04T09:00:24.110-04:00');
    expect(result).not.toContain('T');
    expect(result).not.toContain('-04:00');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/Jun/);
  });

  it('humanizes a UTC ISO datetime string', () => {
    const result = formatDisplayValue('2026-01-15T14:30:00Z');
    expect(result).not.toContain('T');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/Jan/);
  });

  it('leaves non-date strings untouched', () => {
    expect(formatDisplayValue('3 active')).toBe('3 active');
    expect(formatDisplayValue('America/New_York')).toBe('America/New_York');
  });
});

describe('parseSkillContextInjection', () => {
  it('extracts the name and trimmed body of a skill-context block', () => {
    const result = parseSkillContextInjection('<skill-context name="lens">\n# Lens\nbody text\n</skill-context>');
    expect(result).toEqual({ name: 'lens', body: '# Lens\nbody text' });
  });

  it('tolerates leading and trailing whitespace around the block', () => {
    const result = parseSkillContextInjection('  \n<skill-context name="cron">do things</skill-context>\n  ');
    expect(result).toEqual({ name: 'cron', body: 'do things' });
  });

  it('returns null for a genuine user message that merely mentions the tag', () => {
    expect(parseSkillContextInjection('How does <skill-context> work?')).toBeNull();
  });

  it('returns null for ordinary text', () => {
    expect(parseSkillContextInjection('Generate a morning briefing')).toBeNull();
  });
});
