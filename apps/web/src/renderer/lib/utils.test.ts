import { describe, it, expect } from 'vitest';
import { cn, generateId, formatTime } from './utils';

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
