import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './getErrorMessage';

describe('getErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('preserves messages from Error subclasses', () => {
    class CustomError extends Error {}
    expect(getErrorMessage(new CustomError('custom'))).toBe('custom');
  });

  it('stringifies a string value', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
  });

  it('stringifies a number value', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  it('stringifies null and undefined', () => {
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('stringifies a plain object', () => {
    expect(getErrorMessage({ code: 'E' })).toBe('[object Object]');
  });
});
