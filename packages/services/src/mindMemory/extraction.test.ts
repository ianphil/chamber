import { describe, it, expect } from 'vitest';
import {
  parseDailyLog,
  classifyEntry,
  extractFromLog,
  extractFromMultipleLogs,
  generateEntryName,
  containsSensitive,
} from './extraction';
import type { DailyLogEntry } from './extraction';

const singleSessionLog = `## 2026-04-05

### 14:30 — Session abc123
- Working on SCNS project
- Decided to use Express 5 instead of Fastify
- User prefers TypeScript over JavaScript always
`;

const multiSessionLog = `## 2026-04-05

### 14:30 — Session abc123
- Working on SCNS project
- Decided to use Express 5 instead of Fastify
- User prefers TypeScript over JavaScript always

### 16:45 — Session def456
- Reviewed PR for real estate analysis
- PostgreSQL queries optimized with EXPLAIN ANALYZE
- User wants conventional commits enforced
`;

const noSessionIdLog = `## 2026-04-05

### 09:00
- Morning standup notes
- Remember to always run lint before commit
`;

const realisticLog = `## 2026-04-05

### 14:30 — Session abc123
- Working on SCNS project
- Decided to use Express 5 instead of Fastify
- User prefers TypeScript over JavaScript always
- Dashboard at https://grafana.example.com

### 16:45 — Session def456
- Reviewed PR for real estate analysis
- User dislikes tabs, prefers spaces
- Remember to always run lint before commit
- Docs at https://docs.example.com/api
`;

describe('parseDailyLog', () => {
  it('parses a single session entry with time and session ID', () => {
    const entries = parseDailyLog(singleSessionLog, '2026-04-05');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual<DailyLogEntry>({
      date: '2026-04-05',
      time: '14:30',
      sessionId: 'abc123',
      lines: [
        'Working on SCNS project',
        'Decided to use Express 5 instead of Fastify',
        'User prefers TypeScript over JavaScript always',
      ],
    });
  });

  it('parses multiple session entries in one log', () => {
    const entries = parseDailyLog(multiSessionLog, '2026-04-05');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.sessionId).toBe('abc123');
    expect(entries[1]!.sessionId).toBe('def456');
  });

  it('parses entry without session ID (just time header)', () => {
    const entries = parseDailyLog(noSessionIdLog, '2026-04-05');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sessionId).toBeNull();
    expect(entries[0]!.time).toBe('09:00');
  });

  it('returns empty array for empty content', () => {
    expect(parseDailyLog('', '2026-04-05')).toEqual([]);
    expect(parseDailyLog('   \n\n  ', '2026-04-05')).toEqual([]);
  });

  it('strips bullet "- " prefix from lines', () => {
    const entries = parseDailyLog(multiSessionLog, '2026-04-05');
    for (const line of entries[0]!.lines) {
      expect(line).not.toMatch(/^- /);
    }
  });
});

describe('classifyEntry', () => {
  it('classifies "User prefers TypeScript" as user type', () => {
    const result = classifyEntry('User prefers TypeScript');
    expect(result?.type).toBe('user');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('classifies "Decided to use Express 5" as project type', () => {
    expect(classifyEntry('Decided to use Express 5')?.type).toBe('project');
  });

  it('classifies "Remember to always run lint before commit" as feedback type', () => {
    expect(classifyEntry('Remember to always run lint before commit')?.type).toBe('feedback');
  });

  it('classifies "Dashboard at https://grafana.example.com" as reference type', () => {
    expect(classifyEntry('Dashboard at https://grafana.example.com')?.type).toBe('reference');
  });

  it('returns null for routine action "Fixed a bug in the parser"', () => {
    expect(classifyEntry('Fixed a bug in the parser')).toBeNull();
  });

  it('returns null for status update "Working on SCNS project"', () => {
    expect(classifyEntry('Working on SCNS project')).toBeNull();
  });
});

describe('extractFromLog', () => {
  it('extracts entries from a realistic daily log', () => {
    const entries = extractFromLog(realisticLog, '2026-04-05');
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.type).toMatch(/^(user|feedback|project|reference|prohibition)$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('returns empty array for empty log', () => {
    expect(extractFromLog('', '2026-04-05')).toEqual([]);
  });

  it('sets correct source on entries', () => {
    const entries = extractFromLog(realisticLog, '2026-04-05');
    for (const entry of entries) {
      expect(entry.source).toBe('daily-log:2026-04-05');
    }
  });

  it('sets correct createdAt on entries', () => {
    const entries = extractFromLog(realisticLog, '2026-04-05');
    for (const entry of entries) {
      expect(entry.createdAt).toMatch(/^2026-04-05T\d{2}:\d{2}:00Z$/);
    }
  });
});

describe('extractFromMultipleLogs', () => {
  it('combines entries from two logs sorted by date', () => {
    const log1 = `## 2026-04-04\n\n### 10:00 — Session aaa\n- User prefers dark mode\n`;
    const log2 = `## 2026-04-05\n\n### 14:00 — Session bbb\n- Decided to use PostgreSQL\n`;
    const entries = extractFromMultipleLogs([
      { content: log1, date: '2026-04-04' },
      { content: log2, date: '2026-04-05' },
    ]);
    expect(entries.length).toBe(2);
    expect(entries[0]!.createdAt!.startsWith('2026-04-04')).toBe(true);
    expect(entries[1]!.createdAt!.startsWith('2026-04-05')).toBe(true);
  });

  it('deduplicates across logs (same fact → keep latest)', () => {
    const log1 = `## 2026-04-04\n\n### 10:00 — Session aaa\n- User prefers dark mode\n`;
    const log2 = `## 2026-04-05\n\n### 14:00 — Session bbb\n- User prefers dark mode\n`;
    const entries = extractFromMultipleLogs([
      { content: log1, date: '2026-04-04' },
      { content: log2, date: '2026-04-05' },
    ]);
    expect(entries.length).toBe(1);
    expect(entries[0]!.createdAt!.startsWith('2026-04-05')).toBe(true);
  });
});

describe('generateEntryName', () => {
  it('truncates long content to ~60 chars', () => {
    const name = generateEntryName(
      'This is a really long description that goes on and on and should be truncated to fit within sixty characters or so',
    );
    expect(name.length).toBeLessThanOrEqual(60);
  });

  it('removes leading bullet markers', () => {
    expect(generateEntryName('- User prefers TypeScript')).not.toMatch(/^-/);
  });

  it('title-cases the result', () => {
    expect(generateEntryName('user prefers dark mode')).toBe('User Prefers Dark Mode');
  });

  it('handles empty string', () => {
    expect(generateEntryName('')).toBe('');
  });
});

describe('containsSensitive — redaction guard', () => {
  it('detects OpenAI-style sk- API keys', () => {
    expect(containsSensitive('My API key is sk-abc123def456ghi789jkl012mno345pq')).toBe(true);
  });

  it('detects AWS access keys (AKIA...)', () => {
    expect(containsSensitive('Use access key AKIAIOSFODNN7EXAMPLE for S3')).toBe(true);
  });

  it('detects GitHub-style ghp_ tokens', () => {
    expect(containsSensitive('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
  });

  it('detects "password is X" patterns', () => {
    expect(containsSensitive('the database password is hunter2')).toBe(true);
  });

  it('detects "secret = X" patterns', () => {
    expect(containsSensitive('SECRET_TOKEN = abc123xyz789def456')).toBe(true);
  });

  it('does not flag innocent mentions of "key" or "token"', () => {
    expect(containsSensitive('We use JWT tokens for auth')).toBe(false);
    expect(containsSensitive('The primary key is the user ID')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chamber-flavored fixture pack (5 cases — required by Phase 1 plan)
// 3 positives (memorized) + 2 negatives (transient + sensitive redaction)
// ---------------------------------------------------------------------------
describe('Chamber fixture pack — extractFromLog', () => {
  const date = '2026-04-15';
  const log = `## ${date}

### 10:00 — Session chamber-fixture
- I prefer concise commit messages
- We're using Postgres for the auth service
- Stop saying 'sure thing'
- Run npm test
- My API key is sk-abc123def456ghi789jkl012mno345pq
`;

  it('positive: "I prefer concise commit messages" → user entry', () => {
    const entries = extractFromLog(log, date);
    const match = entries.find((e) => e.content.toLowerCase().includes('concise commit'));
    expect(match).toBeDefined();
    expect(match!.type).toBe('user');
  });

  it('positive: "We\'re using Postgres for the auth service" → project entry', () => {
    const entries = extractFromLog(log, date);
    const match = entries.find((e) => e.content.toLowerCase().includes('postgres'));
    expect(match).toBeDefined();
    expect(match!.type).toBe('project');
  });

  it('positive: "Stop saying \'sure thing\'" → prohibition entry', () => {
    const entries = extractFromLog(log, date);
    const match = entries.find((e) => e.type === 'prohibition');
    expect(match).toBeDefined();
  });

  it('negative: "Run npm test" → transient, NOT memorized', () => {
    const entries = extractFromLog(log, date);
    const match = entries.find((e) => e.content.toLowerCase().includes('run npm test'));
    expect(match).toBeUndefined();
  });

  it('negative: "My API key is sk-..." → sensitive, NOT memorized (redaction guard)', () => {
    const entries = extractFromLog(log, date);
    const leaked = entries.find(
      (e) =>
        e.content.includes('sk-abc123def456ghi789jkl012mno345pq') ||
        e.description.includes('sk-abc123def456ghi789jkl012mno345pq'),
    );
    expect(leaked).toBeUndefined();
  });

  it('redaction guard also catches sensitive content even when classifier matches', () => {
    // "I prefer using sk-..." would normally match the user 'prefer' pattern.
    // The redaction guard must override and drop the entry.
    const sneaky = `## ${date}\n\n### 11:00 — Session sneaky\n- I prefer using sk-abc123def456ghi789jkl012mno345pq for auth\n`;
    const entries = extractFromLog(sneaky, date);
    expect(entries.find((e) => e.content.includes('sk-'))).toBeUndefined();
  });
});
