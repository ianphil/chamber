import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatroomSessionStore } from './ChatroomSessionStore';
import type { ChatroomMessage, ChatroomTranscript } from '@chamber/shared/chatroom-types';

function freshTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-chatroom-sessions-'));
}

function makeUserMessage(id: string, content: string): ChatroomMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', content }],
    timestamp: Date.now(),
    sender: { mindId: 'user', name: 'You' },
    roundId: 'r-' + id,
  };
}

describe('ChatroomSessionStore', () => {
  let userDataDir: string;
  let store: ChatroomSessionStore;

  beforeEach(() => {
    userDataDir = freshTmp();
    store = new ChatroomSessionStore(userDataDir);
    store.initialize();
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('starts with no sessions and no active pointer', () => {
    expect(store.list()).toEqual([]);
    expect(store.getActiveSessionId()).toBeNull();
  });

  it('creates a new session with a default title and persists it', () => {
    const created = store.create();
    expect(created.title).toBe('New chatroom');
    expect(created.transcript.messages).toEqual([]);

    const sessions = store.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(created.sessionId);
    expect(sessions[0].hasMessages).toBe(false);
    expect(sessions[0].active).toBe(false);
  });

  it('flips the active pointer and reflects it in list()', () => {
    const a = store.create({ title: 'A' });
    const b = store.create({ title: 'B' });

    store.setActiveSessionId(b.sessionId);

    const sessions = store.list();
    const active = sessions.find((s) => s.active);
    expect(active?.sessionId).toBe(b.sessionId);
    expect(sessions.filter((s) => s.active)).toHaveLength(1);
    expect(store.getActiveSessionId()).toBe(b.sessionId);
    // Ensure both still exist regardless of active state
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([a.sessionId, b.sessionId].sort());
  });

  it('persists transcript updates via save() and bumps updatedAt', async () => {
    const created = store.create({ title: 'Session A' });
    const baseUpdatedAt = created.updatedAt;
    // Yield so the next ISO timestamp can differ from the create one.
    await new Promise((r) => setTimeout(r, 5));

    const updatedTranscript: ChatroomTranscript = {
      version: 1,
      messages: [makeUserMessage('m1', 'hello')],
      taskLedger: [],
      disabledMindIds: [],
    };
    const saved = store.save(created.sessionId, updatedTranscript);

    expect(saved.transcript.messages).toHaveLength(1);
    expect(saved.updatedAt >= baseUpdatedAt).toBe(true);

    const reloaded = store.load(created.sessionId);
    expect(reloaded.transcript.messages).toHaveLength(1);
    expect(reloaded.title).toBe('Session A');

    const summaries = store.list();
    expect(summaries[0].hasMessages).toBe(true);
  });

  it('rename trims input and rejects empty titles', () => {
    const created = store.create();
    const renamed = store.rename(created.sessionId, '   Renamed Room   ');
    expect(renamed.title).toBe('Renamed Room');
    expect(store.load(created.sessionId).title).toBe('Renamed Room');

    expect(() => store.rename(created.sessionId, '   ')).toThrow(/cannot be empty/i);
  });

  it('delete removes the session file and clears the active pointer if needed', () => {
    const a = store.create();
    const b = store.create();
    store.setActiveSessionId(a.sessionId);

    store.delete(a.sessionId);
    expect(store.list().map((s) => s.sessionId)).toEqual([b.sessionId]);
    // Active pointer cleared because we deleted the active session.
    expect(store.getActiveSessionId()).toBeNull();
  });

  it('delete leaves the active pointer untouched when deleting a non-active session', () => {
    const a = store.create();
    const b = store.create();
    store.setActiveSessionId(a.sessionId);

    store.delete(b.sessionId);
    expect(store.getActiveSessionId()).toBe(a.sessionId);
  });

  it('getActiveSessionId clears a stale pointer if the file is gone', () => {
    const a = store.create();
    store.setActiveSessionId(a.sessionId);
    // Delete the file behind the store's back (e.g. user wiped it manually).
    fs.rmSync(path.join(userDataDir, 'chatroom-sessions', a.sessionId + '.json'));

    expect(store.getActiveSessionId()).toBeNull();
  });

  it('list sorts newest-first by updatedAt', async () => {
    const a = store.create({ title: 'older' });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({ title: 'newer' });

    const sessions = store.list();
    expect(sessions[0].sessionId).toBe(b.sessionId);
    expect(sessions[1].sessionId).toBe(a.sessionId);
  });

  describe('legacy migration', () => {
    it('wraps an existing chatroom.json as a "Chatroom 1" session and renames the legacy file', () => {
      // Simulate a pre-upgrade install: write the legacy file in a fresh
      // userData dir BEFORE the store initializes.
      const legacyDir = freshTmp();
      const legacyFile = path.join(legacyDir, 'chatroom.json');
      const transcript: ChatroomTranscript = {
        version: 1,
        messages: [makeUserMessage('legacy-1', 'historical message')],
        taskLedger: [],
        disabledMindIds: ['disabled-mind-id'],
      };
      fs.writeFileSync(legacyFile, JSON.stringify(transcript));

      const migrated = new ChatroomSessionStore(legacyDir);
      migrated.initialize();

      // Original legacy file moved aside, not deleted.
      expect(fs.existsSync(legacyFile)).toBe(false);
      expect(fs.existsSync(path.join(legacyDir, 'chatroom.json.legacy'))).toBe(true);

      const sessions = migrated.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].title).toBe('Chatroom 1');
      expect(sessions[0].active).toBe(true);

      const loaded = migrated.load(sessions[0].sessionId);
      expect(loaded.transcript.messages).toHaveLength(1);
      expect(loaded.transcript.disabledMindIds).toEqual(['disabled-mind-id']);

      fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    it('runs the legacy migration at most once', () => {
      const legacyDir = freshTmp();
      const legacyFile = path.join(legacyDir, 'chatroom.json');
      fs.writeFileSync(
        legacyFile,
        JSON.stringify({ version: 1, messages: [], taskLedger: [], disabledMindIds: [] } satisfies ChatroomTranscript),
      );

      const first = new ChatroomSessionStore(legacyDir);
      first.initialize();
      expect(first.list()).toHaveLength(1);

      // Second initialize should NOT re-import the now-renamed file.
      const second = new ChatroomSessionStore(legacyDir);
      second.initialize();
      expect(second.list()).toHaveLength(1);

      fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    it('backs up an unrecognized legacy file shape without importing it', () => {
      const legacyDir = freshTmp();
      const legacyFile = path.join(legacyDir, 'chatroom.json');
      fs.writeFileSync(legacyFile, JSON.stringify({ version: 99, garbage: true }));

      const migrated = new ChatroomSessionStore(legacyDir);
      migrated.initialize();

      expect(fs.existsSync(legacyFile)).toBe(false);
      expect(fs.existsSync(path.join(legacyDir, 'chatroom.json.legacy'))).toBe(true);
      expect(migrated.list()).toHaveLength(0);

      fs.rmSync(legacyDir, { recursive: true, force: true });
    });
  });

  it('load throws for an unknown sessionId', () => {
    expect(() => store.load('does-not-exist')).toThrow(/not found/i);
  });

  it('ignores stray non-session files in the sessions directory', () => {
    store.create({ title: 'real session' });
    const sessionsDir = path.join(userDataDir, 'chatroom-sessions');
    fs.writeFileSync(path.join(sessionsDir, 'README.md'), '# stray\n');

    expect(store.list()).toHaveLength(1);
  });
});
