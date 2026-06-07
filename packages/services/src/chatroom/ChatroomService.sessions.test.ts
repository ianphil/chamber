/**
 * Session-API integration tests for ChatroomService.
 *
 * Uses real fs in os.tmpdir() (NO global node:fs mock) so the store layer
 * behind ChatroomService is exercised end-to-end. The ChatroomService.test
 * file mocks fs aggressively to assert in-memory broadcast behavior; this
 * file is its complement for the session lifecycle: createSession,
 * listSessions, resumeSession, renameSession, deleteSession, plus the
 * one-time legacy chatroom.json migration on first construction.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatroomService, type ChatroomSessionFactory } from './ChatroomService';
import type { MindContext } from '@chamber/shared/types';
import type { AppPaths } from '../ports';
import type { ChatroomTranscript, ChatroomMessage } from '@chamber/shared/chatroom-types';

function freshUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-chatroom-svc-'));
}

function makePaths(userData: string): AppPaths {
  return { userData, logs: userData, cache: userData, temp: userData };
}

function mind(id: string, name: string): MindContext {
  return {
    mindId: id,
    mindPath: '/minds/' + id,
    identity: { name, systemMessage: 'I am ' + name },
    status: 'ready',
  };
}

function emptyFactory(minds: MindContext[] = []): ChatroomSessionFactory & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    createChatroomSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnValue(vi.fn()),
    }),
    listMinds: vi.fn(() => minds),
  }) as unknown as ChatroomSessionFactory & EventEmitter;
}

describe('ChatroomService (sessions)', () => {
  let userData: string;
  let svc: ChatroomService;

  beforeEach(() => {
    userData = freshUserData();
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('starts with no sessions when there is no legacy file', () => {
    svc = new ChatroomService(emptyFactory(), makePaths(userData));
    expect(svc.listSessions()).toEqual([]);
    expect(svc.getHistory()).toEqual([]);
    expect(svc.getDisabledMindIds()).toEqual([]);
  });

  it('createSession returns a summary and does not flip the active session', () => {
    svc = new ChatroomService(emptyFactory(), makePaths(userData));

    const created = svc.createSession('Project planning');

    expect(created.title).toBe('Project planning');
    expect(created.hasMessages).toBe(false);
    expect(created.active).toBe(false);

    const sessions = svc.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(created.sessionId);
  });

  it('resumeSession activates the session and returns its transcript', () => {
    svc = new ChatroomService(emptyFactory(), makePaths(userData));

    const a = svc.createSession('A');
    const b = svc.createSession('B');

    const resumedB = svc.resumeSession(b.sessionId);
    expect(resumedB.session.sessionId).toBe(b.sessionId);
    expect(resumedB.session.active).toBe(true);
    expect(resumedB.messages).toEqual([]);

    // Active flipped to B.
    const sessions = svc.listSessions();
    expect(sessions.find((s) => s.sessionId === b.sessionId)?.active).toBe(true);
    expect(sessions.find((s) => s.sessionId === a.sessionId)?.active).toBe(false);
  });

  it('renameSession updates the title and returns the refreshed list', () => {
    svc = new ChatroomService(emptyFactory(), makePaths(userData));
    const created = svc.createSession('Old name');

    const updated = svc.renameSession(created.sessionId, 'New name');
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe('New name');

    // Persisted to disk
    const second = new ChatroomService(emptyFactory(), makePaths(userData));
    expect(second.listSessions()[0].title).toBe('New name');
  });

  it('deleteSession removes the session and clears active if it was active', () => {
    svc = new ChatroomService(emptyFactory(), makePaths(userData));
    const a = svc.createSession('A');
    const b = svc.createSession('B');
    svc.resumeSession(b.sessionId);

    const remaining = svc.deleteSession(b.sessionId);

    expect(remaining.map((s) => s.sessionId)).toEqual([a.sessionId]);
    expect(svc.getHistory()).toEqual([]); // active is now null
  });

  it('legacy chatroom.json is migrated to a Chatroom 1 session and made active', () => {
    const transcript: ChatroomTranscript = {
      version: 1,
      messages: [
        {
          id: 'old-1',
          role: 'user',
          blocks: [{ type: 'text', content: 'historical message' }],
          timestamp: Date.now(),
          sender: { mindId: 'user', name: 'You' },
          roundId: 'r-old',
        },
      ],
      taskLedger: [],
      disabledMindIds: ['some-disabled-mind'],
    };
    fs.writeFileSync(path.join(userData, 'chatroom.json'), JSON.stringify(transcript));

    svc = new ChatroomService(emptyFactory(), makePaths(userData));

    const sessions = svc.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Chatroom 1');
    expect(sessions[0].active).toBe(true);

    // History + disabled set transferred to the active session.
    expect(svc.getHistory()).toHaveLength(1);
    expect(svc.getDisabledMindIds()).toEqual(['some-disabled-mind']);

    // Legacy file renamed aside so the next startup does not re-migrate.
    expect(fs.existsSync(path.join(userData, 'chatroom.json'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'chatroom.json.legacy'))).toBe(true);
  });

  it('legacy migration runs at most once', () => {
    fs.writeFileSync(
      path.join(userData, 'chatroom.json'),
      JSON.stringify({ version: 1, messages: [], taskLedger: [], disabledMindIds: [] } satisfies ChatroomTranscript),
    );

    // First startup migrates.
    svc = new ChatroomService(emptyFactory(), makePaths(userData));
    expect(svc.listSessions()).toHaveLength(1);

    // Second startup does NOT create a duplicate.
    const second = new ChatroomService(emptyFactory(), makePaths(userData));
    expect(second.listSessions()).toHaveLength(1);
  });

  it('legacy migration restores active pointer so getHistory returns the migrated messages on restart', () => {
    const transcript: ChatroomTranscript = {
      version: 1,
      messages: [
        {
          id: 'm-1',
          role: 'user',
          blocks: [{ type: 'text', content: 'survives a restart' }],
          timestamp: 1,
          sender: { mindId: 'user', name: 'You' },
          roundId: 'r1',
        },
      ],
      taskLedger: [],
      disabledMindIds: [],
    };
    fs.writeFileSync(path.join(userData, 'chatroom.json'), JSON.stringify(transcript));

    // First service migrates and sets active pointer.
    new ChatroomService(emptyFactory(), makePaths(userData));

    // Second service starts fresh; active pointer should re-load the session.
    const second = new ChatroomService(emptyFactory(), makePaths(userData));
    expect(second.getHistory()).toHaveLength(1);
    expect(second.getHistory()[0].id).toBe('m-1');
  });

  it('setMindEnabled scopes the disabled set to the active session', () => {
    svc = new ChatroomService(emptyFactory([mind('m1', 'M1')]), makePaths(userData));

    const a = svc.createSession('A');
    const b = svc.createSession('B');
    svc.resumeSession(a.sessionId);
    svc.setMindEnabled('m1', false);
    expect(svc.getDisabledMindIds()).toEqual(['m1']);

    // Switching to B starts with its own empty disabled set.
    svc.resumeSession(b.sessionId);
    expect(svc.getDisabledMindIds()).toEqual([]);

    // Returning to A still has its disabled set.
    svc.resumeSession(a.sessionId);
    expect(svc.getDisabledMindIds()).toEqual(['m1']);
  });

  // Restored after the sessions refactor: the 500-message cap and the
  // ledger-update debounce live in ChatroomService.persist/schedulePersist and
  // lost their coverage when the old mocked-fs persistence suite was deleted.
  describe('persistence cap + ledger debounce', () => {
    it('trims the active transcript to 500 messages on save', async () => {
      const existing: ChatroomMessage[] = [];
      for (let i = 0; i < 499; i++) {
        existing.push({
          id: `old-${i}`,
          role: 'user',
          blocks: [{ type: 'text', content: `msg ${i}` }],
          timestamp: i,
          sender: { mindId: 'user', name: 'You' },
          roundId: `round-${i}`,
        });
      }
      // Seed a legacy transcript; it migrates into the active session.
      fs.writeFileSync(
        path.join(userData, 'chatroom.json'),
        JSON.stringify({ version: 1, messages: existing, taskLedger: [], disabledMindIds: [] }),
      );

      svc = new ChatroomService(emptyFactory(), makePaths(userData));
      expect(svc.getHistory()).toHaveLength(499);

      // A broadcast (even with no participants) appends messages and persists,
      // pushing the transcript past the cap so the oldest entries are trimmed.
      await svc.broadcast('one more');

      const history = svc.getHistory();
      expect(history.length).toBeLessThanOrEqual(500);
      expect(history.some((m) => m.id === 'old-0')).toBe(false);
    });

    it('loads a transcript defensively when disabledMindIds is malformed (not an array)', () => {
      fs.writeFileSync(path.join(userData, 'chatroom.json'), JSON.stringify({
        version: 1,
        messages: [{ id: 'm1', role: 'user', blocks: [{ type: 'text', content: 'hi' }], timestamp: 1, sender: { mindId: 'user', name: 'You' }, roundId: 'r1' }],
        disabledMindIds: 'not-an-array',
      }));

      svc = new ChatroomService(emptyFactory(), makePaths(userData));
      expect(svc.getHistory()).toHaveLength(1);
      expect(svc.getDisabledMindIds()).toEqual([]);
    });

    it('debounces a burst of ledger-update events, persisting the final ledger once', async () => {
      svc = new ChatroomService(emptyFactory(), makePaths(userData));
      const created = svc.createSession('debounce');
      svc.resumeSession(created.sessionId);
      const sessionFile = path.join(userData, 'chatroom-sessions', `${created.sessionId}.json`);

      vi.useFakeTimers();
      try {
        for (let i = 0; i < 25; i++) {
          svc.emit('chatroom:event', {
            roundId: 'r1',
            mindId: 'magentic-orchestrator',
            event: {
              type: 'orchestration:task-ledger-update',
              data: { ledger: [{ id: `t${i}`, description: `task ${i}`, status: 'pending' }] },
            },
          });
        }

        // Deferred: the synchronous burst has not yet been flushed to disk.
        const before = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as { transcript?: { taskLedger?: unknown[] } };
        expect(before.transcript?.taskLedger ?? []).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(600);

        // Coalesced: a single debounced flush persisted the final ledger state.
        const after = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as { transcript: { taskLedger: Array<{ id: string }> } };
        expect(after.transcript.taskLedger).toHaveLength(1);
        expect(after.transcript.taskLedger[0].id).toBe('t24');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
