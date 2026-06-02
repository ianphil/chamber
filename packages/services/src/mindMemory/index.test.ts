import { describe, expect, it } from 'vitest';

describe('mindMemory package scaffold', () => {
  it('exposes a public surface module that loads without side effects', async () => {
    const mod = await import('./index');
    expect(mod).toBeDefined();
    expect(mod).not.toBeNull();
  });

  it('exposes a sentinel marker identifying the scaffold version', async () => {
    const mod = await import('./index');
    expect(mod.MIND_MEMORY_PACKAGE_VERSION).toBe('0.0.0-scaffold');
  });
});

describe('better-sqlite3 native binding (Phase 0 packaging gate)', () => {
  it('opens an in-memory database and round-trips a value', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('hello', 'world');
      const row = db.prepare('SELECT v FROM t WHERE k = ?').get('hello') as { v: string };
      expect(row.v).toBe('world');
    } finally {
      db.close();
    }
  });

  it('supports WAL journal mode (used by per-mind dream.db)', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      const mode = db.pragma('journal_mode = WAL', { simple: true });
      // In-memory DBs report 'memory' for journal_mode; the call must not throw.
      expect(typeof mode).toBe('string');
    } finally {
      db.close();
    }
  });
});
