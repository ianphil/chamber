import { describe, it, expect } from 'vitest';
import { TokenRegistry } from './TokenRegistry';

describe('TokenRegistry', () => {
  it('mints unique base64url tokens bound to {mindId, runId}', () => {
    const reg = new TokenRegistry();
    const a = reg.mint('mind-1', 'run-1');
    const b = reg.mint('mind-1', 'run-2');
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.mindId).toBe('mind-1');
    expect(a.runId).toBe('run-1');
  });

  it('verifies a minted token and returns its binding', () => {
    const reg = new TokenRegistry();
    const minted = reg.mint('mind-1', 'run-1');
    expect(reg.verify(minted.token)).toEqual({ mindId: 'mind-1', runId: 'run-1' });
  });

  it('rejects unknown tokens', () => {
    const reg = new TokenRegistry();
    reg.mint('mind-1', 'run-1');
    expect(reg.verify('not-a-real-token')).toBeNull();
    expect(reg.verify('')).toBeNull();
  });

  it('rejects revoked tokens', () => {
    const reg = new TokenRegistry();
    const minted = reg.mint('mind-1', 'run-1');
    reg.revoke(minted.token);
    expect(reg.verify(minted.token)).toBeNull();
    expect(reg.size()).toBe(0);
  });

  it('revokeRun revokes every token bound to that run', () => {
    const reg = new TokenRegistry();
    const a = reg.mint('mind-1', 'run-1');
    const b = reg.mint('mind-1', 'run-1');
    const c = reg.mint('mind-1', 'run-2');
    reg.revokeRun('run-1');
    expect(reg.verify(a.token)).toBeNull();
    expect(reg.verify(b.token)).toBeNull();
    expect(reg.verify(c.token)?.runId).toBe('run-2');
  });
});
