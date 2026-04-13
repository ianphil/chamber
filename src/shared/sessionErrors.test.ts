import { describe, it, expect } from 'vitest';
import { isStaleSessionError } from './sessionErrors';

describe('isStaleSessionError', () => {
  it('returns true for Error with "Session not found: <id>" message', () => {
    expect(isStaleSessionError(new Error('Session not found: abc-123'))).toBe(true);
  });

  it('returns true for "Session not found" with no id suffix', () => {
    expect(isStaleSessionError(new Error('Session not found'))).toBe(true);
  });

  it('returns false for Error with different message', () => {
    expect(isStaleSessionError(new Error('Network error'))).toBe(false);
  });

  it('returns false for a plain string (not an Error instance)', () => {
    expect(isStaleSessionError('Session not found: abc-123')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isStaleSessionError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isStaleSessionError(undefined)).toBe(false);
  });
});
