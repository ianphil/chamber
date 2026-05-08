import { describe, it, expect } from 'vitest';
import { createServerContext } from './composition';
import type { ChamberCtx } from './types';

const noop = () => undefined;
const asyncNoop = async () => undefined;
const asyncList = async () => [];
const asyncRecord = async () => ({});

const fullCapabilities: Omit<ChamberCtx, 'token' | 'allowedOrigins'> = {
  listMinds: () => [],
  addMind: asyncRecord,
  getConfig: asyncRecord,
  listLensViews: asyncList,
  getGenesisStatus: asyncRecord,
  getAuthStatus: asyncRecord,
  listAuthAccounts: asyncList,
  startAuthLogin: async () => ({ success: false }),
  switchAuthAccount: asyncNoop,
  logoutAuth: asyncNoop,
  listChamberTools: () => [],
  saveAttachment: asyncRecord,
  sendChat: noop,
  newConversation: noop,
  cancelChat: noop,
  listModels: () => [],
  shutdown: noop,
  handlePrivilegedRequest: async () => ({ ok: true as const, requestId: 'r1' }),
};

describe('createServerContext', () => {
  it('defaults token and allowedOrigins when omitted', () => {
    const ctx = createServerContext({ ...fullCapabilities });
    expect(ctx.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ctx.allowedOrigins.has('http://127.0.0.1')).toBe(true);
  });

  it('honors explicit token and allowedOrigins', () => {
    const ctx = createServerContext({
      token: 'explicit',
      allowedOrigins: ['https://example.test'],
      ...fullCapabilities,
    });
    expect(ctx.token).toBe('explicit');
    expect(ctx.allowedOrigins.has('https://example.test')).toBe(true);
  });

  // Compile-time tripwire: removing `?` from a route-backed capability on
  // ChamberCtx is the whole point of #138. If a future change adds the
  // optional modifier back (or drops a required field from the inputs),
  // these `@ts-expect-error` lines will no longer be errors and the build
  // breaks here. Without this test the regression is silent.
  it('refuses inputs that omit any required capability (compile-time)', () => {
    // @ts-expect-error: every route-backed capability is required
    createServerContext({ token: 't', allowedOrigins: ['http://127.0.0.1'] });

    // @ts-expect-error: addMind is required
    createServerContext({ ...fullCapabilities, addMind: undefined });

    // @ts-expect-error: sendChat is required
    createServerContext({ ...fullCapabilities, sendChat: undefined });

    // @ts-expect-error: handlePrivilegedRequest is required
    createServerContext({ ...fullCapabilities, handlePrivilegedRequest: undefined });

    expect(true).toBe(true);
  });
});
