import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, isAuthorized, isLoopbackHost } from './auth';

describe('isLoopbackHost', () => {
  it('accepts 127.0.0.1 and localhost (with or without a port)', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:55123')).toBe(true);
    expect(isLoopbackHost('localhost:8080')).toBe(true);
  });

  it('lowercases the comparison so casing in the host does not matter', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('LocalHost:55123')).toBe(true);
  });

  it('rejects non-loopback hosts and undefined/empty input', () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  const allowed = new Set(['http://127.0.0.1', 'https://app.example.com']);

  it('allows requests with no Origin header (same-origin / native fetchers)', () => {
    expect(isAllowedOrigin(null, allowed)).toBe(true);
  });

  it('matches the exact origin string when present', () => {
    expect(isAllowedOrigin('http://127.0.0.1', allowed)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
  });

  it('matches the protocol+hostname (port-stripped) when the origin is a loopback host', () => {
    expect(isAllowedOrigin('http://127.0.0.1:55123', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:55123', new Set(['http://localhost']))).toBe(true);
  });

  it('does not strip the port for non-loopback origins', () => {
    expect(isAllowedOrigin('https://app.example.com:8443', allowed)).toBe(false);
  });

  it('rejects origins outside the allowlist', () => {
    expect(isAllowedOrigin('https://evil.example.com', allowed)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.2', allowed)).toBe(false);
  });

  it('rejects malformed Origin header values', () => {
    expect(isAllowedOrigin('not a url', allowed)).toBe(false);
  });
});

describe('isAuthorized', () => {
  const token = 'super-secret-token';

  it('accepts the canonical Bearer token', () => {
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  it('rejects a missing or empty Authorization header', () => {
    expect(isAuthorized(null, token)).toBe(false);
    expect(isAuthorized('', token)).toBe(false);
  });

  it('rejects unsupported authentication schemes', () => {
    expect(isAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(isAuthorized(`Token ${token}`, token)).toBe(false);
    expect(isAuthorized(token, token)).toBe(false);
  });

  it('rejects a wrong token of the same length without throwing', () => {
    const wrong = 'X'.repeat(token.length);
    expect(wrong).toHaveLength(token.length);
    expect(isAuthorized(`Bearer ${wrong}`, token)).toBe(false);
  });

  it('rejects tokens of a different length without throwing', () => {
    expect(isAuthorized(`Bearer ${token}extra`, token)).toBe(false);
    expect(isAuthorized('Bearer short', token)).toBe(false);
    expect(isAuthorized('Bearer ', token)).toBe(false);
  });

  it('is case-sensitive on the token value', () => {
    expect(isAuthorized(`Bearer ${token.toUpperCase()}`, token)).toBe(false);
  });
});
