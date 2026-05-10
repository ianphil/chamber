import { describe, it, expect, vi } from 'vitest';
import type { PermissionHandler } from '@github/copilot-sdk';
import { SessionGroup } from './SessionGroup';
import type { SessionGroupSessionFactory } from './types';
import type { CopilotSession } from '../mind';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSession() {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as CopilotSession & { abort: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
}

function fakeFactory(): SessionGroupSessionFactory & {
  createChatroomSession: ReturnType<typeof vi.fn>;
  sessions: Map<string, ReturnType<typeof fakeSession>>;
} {
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const createChatroomSession = vi.fn(async (mindId: string, _h?: PermissionHandler) => {
    void _h;
    const s = fakeSession();
    sessions.set(mindId, s);
    return s;
  });
  return { createChatroomSession, sessions };
}

const noopPermissionFactory = () =>
  (async () => ({ kind: 'approve-once' as const })) as PermissionHandler;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionGroup', () => {
  describe('getOrCreateSession', () => {
    it('creates a session on first call and caches it on subsequent calls', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);

      const a = await group.getOrCreateSession('dude');
      const b = await group.getOrCreateSession('dude');

      expect(a).toBe(b);
      expect(factory.createChatroomSession).toHaveBeenCalledTimes(1);
      expect(group.size).toBe(1);
      expect(group.has('dude')).toBe(true);
    });

    it('builds a fresh session per mind', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);

      await group.getOrCreateSession('dude');
      await group.getOrCreateSession('jarvis');

      expect(factory.createChatroomSession).toHaveBeenCalledTimes(2);
      expect(group.size).toBe(2);
    });

    it('passes the permission handler from the factory into the SDK session factory', async () => {
      const factory = fakeFactory();
      const handler = (async () => ({ kind: 'approve-once' as const })) as PermissionHandler;
      const permissionFactory = vi.fn(() => handler);
      const group = new SessionGroup(factory, permissionFactory);

      await group.getOrCreateSession('dude');

      expect(permissionFactory).toHaveBeenCalledWith('dude');
      expect(factory.createChatroomSession).toHaveBeenCalledWith('dude', handler);
    });
  });

  describe('evictSession', () => {
    it('removes the cached session without aborting it', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      const session = factory.sessions.get('dude');
      if (!session) throw new Error('expected session');

      group.evictSession('dude');

      expect(group.has('dude')).toBe(false);
      expect(session.abort).not.toHaveBeenCalled();
      expect(session.destroy).not.toHaveBeenCalled();
    });

    it('forces the next getOrCreateSession to build a fresh session', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      group.evictSession('dude');

      await group.getOrCreateSession('dude');

      expect(factory.createChatroomSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('abortAll', () => {
    it('aborts every cached session and clears the cache', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      await group.getOrCreateSession('jarvis');
      const dude = factory.sessions.get('dude');
      const jarvis = factory.sessions.get('jarvis');
      if (!dude || !jarvis) throw new Error('expected sessions');

      group.abortAll();

      expect(dude.abort).toHaveBeenCalledTimes(1);
      expect(jarvis.abort).toHaveBeenCalledTimes(1);
      expect(group.size).toBe(0);
    });

    it('swallows errors from abort so a single failure does not block round teardown', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      const dude = factory.sessions.get('dude');
      if (!dude) throw new Error('expected session');
      dude.abort.mockRejectedValueOnce(new Error('boom'));

      expect(() => group.abortAll()).not.toThrow();
      expect(group.size).toBe(0);
    });
  });

  describe('destroyAll', () => {
    it('destroys every cached session and clears the cache', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      await group.getOrCreateSession('jarvis');
      const dude = factory.sessions.get('dude');
      const jarvis = factory.sessions.get('jarvis');
      if (!dude || !jarvis) throw new Error('expected sessions');

      await group.destroyAll();

      expect(dude.destroy).toHaveBeenCalledTimes(1);
      expect(jarvis.destroy).toHaveBeenCalledTimes(1);
      expect(group.size).toBe(0);
    });

    it('swallows errors from destroy', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      const dude = factory.sessions.get('dude');
      if (!dude) throw new Error('expected session');
      dude.destroy.mockRejectedValueOnce(new Error('boom'));

      await expect(group.destroyAll()).resolves.toBeUndefined();
      expect(group.size).toBe(0);
    });
  });

  describe('destroySession', () => {
    it('aborts, destroys, and removes the named mind', async () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);
      await group.getOrCreateSession('dude');
      await group.getOrCreateSession('jarvis');
      const dude = factory.sessions.get('dude');
      const jarvis = factory.sessions.get('jarvis');
      if (!dude || !jarvis) throw new Error('expected sessions');

      group.destroySession('dude');

      expect(dude.abort).toHaveBeenCalledTimes(1);
      expect(dude.destroy).toHaveBeenCalledTimes(1);
      expect(group.has('dude')).toBe(false);
      expect(group.has('jarvis')).toBe(true);
      expect(jarvis.abort).not.toHaveBeenCalled();
      expect(jarvis.destroy).not.toHaveBeenCalled();
    });

    it('is a no-op when the mind has no cached session', () => {
      const factory = fakeFactory();
      const group = new SessionGroup(factory, noopPermissionFactory);

      expect(() => group.destroySession('ghost')).not.toThrow();
      expect(factory.createChatroomSession).not.toHaveBeenCalled();
    });
  });
});
