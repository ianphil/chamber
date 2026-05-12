import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDailyLogWriter } from './DailyLogWriter';
import { STRUCTURED_LOG_SENTINEL, parseLog, type CompletedTurn } from './StructuredLogFormat';

let mindRoot: string;
let logPath: string;
let legacyPath: string;

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-dlw-'));
  logPath = path.join(mindRoot, '.working-memory', 'log.md');
  legacyPath = path.join(mindRoot, '.working-memory', 'log.legacy.md');
});

afterEach(() => {
  fs.rmSync(mindRoot, { recursive: true, force: true });
});

function makeTurn(i: number, status: 'completed' | 'aborted' | 'error' = 'completed'): CompletedTurn {
  const ts = `2026-05-12T17:${String(20 + i).padStart(2, '0')}:00Z`;
  return {
    turnId: `turn-${i}`,
    sessionId: `sess-${i}`,
    model: 'claude-opus-4.7',
    status,
    startedAt: ts,
    endedAt: ts,
    prompt: `prompt body ${i}`,
    finalAssistantMessage: `assistant body ${i}`,
  };
}

function makeWriter(extras: { logger?: { info: (msg: string) => void; warn?: (msg: string, ...args: unknown[]) => void }; rename?: (from: string, to: string) => Promise<void> } = {}) {
  return createDailyLogWriter({
    mindId: 'mind-x',
    mindPath: mindRoot,
    deps: {
      logger: extras.logger,
      rename: extras.rename,
    },
  });
}

describe('DailyLogWriter — round-trip', () => {
  it('writes three turns that parse back via StructuredLogFormat.parseLog', async () => {
    const writer = makeWriter();
    const t1 = makeTurn(1);
    const t2 = makeTurn(2, 'aborted');
    const t3 = makeTurn(3, 'error');

    await writer.write(t1);
    await writer.write(t2);
    await writer.write(t3);

    const content = fs.readFileSync(logPath, 'utf-8');
    const parsed = parseLog(content);

    expect(parsed.sentinel).toBe(true);
    expect(parsed.malformed).toBe(0);
    expect(parsed.turns).toHaveLength(3);
    expect(parsed.turns.map((t) => t.turnId)).toEqual(['turn-1', 'turn-2', 'turn-3']);
    expect(parsed.turns[0].prompt).toBe('prompt body 1');
    expect(parsed.turns[0].assistant).toBe('assistant body 1');
    expect(parsed.turns[1].status).toBe('aborted');
    expect(parsed.turns[2].status).toBe('error');
  });
});

describe('DailyLogWriter — first-call migration (rotation)', () => {
  it('rotates unstructured log.md to log.legacy.md and seeds a fresh structured log', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const legacyContent = '# notes\n\nrandom freeform content\n';
    fs.writeFileSync(logPath, legacyContent);

    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));

    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(legacyContent);
    const fresh = fs.readFileSync(logPath, 'utf-8');
    expect(fresh.startsWith(STRUCTURED_LOG_SENTINEL)).toBe(true);
    const parsed = parseLog(fresh);
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(
      'Rotated unstructured log.md to log.legacy.md for mind mind-x',
    );
  });

  it('idempotent: second write does not re-rotate', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, 'unstructured original\n');

    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));
    const legacyAfterFirst = fs.readFileSync(legacyPath, 'utf-8');

    await writer.write(makeTurn(2));

    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(legacyAfterFirst);
    expect(info).toHaveBeenCalledTimes(1);

    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(2);
  });

  it('collision rule: when log.legacy.md already exists, rotates to log.legacy.<ISO-z>.md', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const priorLegacy = '# previous legacy\n';
    const todayBad = '# today is bad\n';
    fs.writeFileSync(legacyPath, priorLegacy);
    fs.writeFileSync(logPath, todayBad);

    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));

    // Original legacy untouched
    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(priorLegacy);

    // A timestamped legacy file containing today's bad content was created
    const all = fs.readdirSync(path.dirname(logPath));
    const stamped = all.filter(
      (n) => /^log\.legacy\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.md$/.test(n),
    );
    expect(stamped).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(logPath), stamped[0]), 'utf-8')).toBe(todayBad);

    // Fresh log.md is structured
    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(1);

    expect(info).toHaveBeenCalledWith(
      `Rotated unstructured log.md to ${stamped[0]} for mind mind-x`,
    );
  });

  it('empty log.md is treated as already-structured: no rotation', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '');

    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(info).not.toHaveBeenCalled();

    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(1);
  });

  it('structured log.md (sentinel present) is left in place', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const seed = `${STRUCTURED_LOG_SENTINEL}\n\n`;
    fs.writeFileSync(logPath, seed);

    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(info).not.toHaveBeenCalled();

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content.startsWith(seed)).toBe(true);
    const parsed = parseLog(content);
    expect(parsed.turns).toHaveLength(1);
  });

  it('creates the directory and log.md when none exist (no rotation)', async () => {
    const info = vi.fn();
    const writer = makeWriter({ logger: { info } });

    await writer.write(makeTurn(1));

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(info).not.toHaveBeenCalled();
    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.turns).toHaveLength(1);
  });
});

describe('DailyLogWriter — concurrency', () => {
  it('serializes concurrent appends without interleaving', async () => {
    const writer = makeWriter();

    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(i + 1));
    await Promise.all(turns.map((t) => writer.write(t)));

    const content = fs.readFileSync(logPath, 'utf-8');

    // Sentinel appears exactly once.
    const sentinelCount = content.split(STRUCTURED_LOG_SENTINEL).length - 1;
    expect(sentinelCount).toBe(1);

    const parsed = parseLog(content);
    expect(parsed.sentinel).toBe(true);
    expect(parsed.malformed).toBe(0);
    expect(parsed.turns).toHaveLength(10);

    const ids = new Set(parsed.turns.map((t) => t.turnId));
    expect(ids.size).toBe(10);
    for (let i = 1; i <= 10; i++) {
      expect(ids.has(`turn-${i}`)).toBe(true);
    }

    // Spot-check no body interleaving: each parsed prompt/assistant matches its turn id.
    for (const t of parsed.turns) {
      const i = t.turnId.replace('turn-', '');
      expect(t.prompt).toBe(`prompt body ${i}`);
      expect(t.assistant).toBe(`assistant body ${i}`);
    }
  });
});

describe('DailyLogWriter — onTurnRecorded hook', () => {
  it('invokes onTurnRecorded once per successful write with the same CompletedTurn payload', async () => {
    const onTurnRecorded = vi.fn();
    const writer = createDailyLogWriter({
      mindId: 'mind-x',
      mindPath: mindRoot,
      deps: { onTurnRecorded },
    });

    const t1 = makeTurn(1);
    const t2 = makeTurn(2);
    await writer.write(t1);
    await writer.write(t2);

    expect(onTurnRecorded).toHaveBeenCalledTimes(2);
    expect(onTurnRecorded).toHaveBeenNthCalledWith(1, t1);
    expect(onTurnRecorded).toHaveBeenNthCalledWith(2, t2);
  });

  it('does NOT invoke onTurnRecorded when the underlying write fails', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '# unstructured original\n');

    const onTurnRecorded = vi.fn();
    const failingRename = vi.fn(async () => {
      throw new Error('synthetic rename failure');
    });
    const writer = createDailyLogWriter({
      mindId: 'mind-x',
      mindPath: mindRoot,
      deps: { onTurnRecorded, rename: failingRename },
    });

    await expect(writer.write(makeTurn(1))).rejects.toThrow(/synthetic rename failure/);
    expect(onTurnRecorded).not.toHaveBeenCalled();
  });

  it('a throwing onTurnRecorded does not roll back the on-disk write but propagates the error', async () => {
    const onTurnRecorded = vi.fn(() => {
      throw new Error('observer threw');
    });
    const writer = createDailyLogWriter({
      mindId: 'mind-x',
      mindPath: mindRoot,
      deps: { onTurnRecorded },
    });

    await expect(writer.write(makeTurn(1))).rejects.toThrow(/observer threw/);

    // The structured log was still written before the hook was called.
    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(1);
  });
});

describe('DailyLogWriter — error path safety', () => {
  it('rotation rename failure leaves log.md byte-equal and rejects the write', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const original = '# unstructured original content\nline two\n';
    fs.writeFileSync(logPath, original);

    const failingRename = vi.fn(async () => {
      throw new Error('synthetic rename failure');
    });
    const info = vi.fn();
    const writer = makeWriter({ logger: { info }, rename: failingRename });

    await expect(writer.write(makeTurn(1))).rejects.toThrow(/synthetic rename failure/);

    expect(fs.readFileSync(logPath, 'utf-8')).toBe(original);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('after a failed rotation, a subsequent successful write rotates and recovers', async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const original = '# unstructured original\n';
    fs.writeFileSync(logPath, original);

    let calls = 0;
    const flakyRename = vi.fn(async (from: string, to: string) => {
      calls++;
      if (calls === 1) throw new Error('first attempt fails');
      await fsp.rename(from, to);
    });
    const writer = makeWriter({ rename: flakyRename });

    await expect(writer.write(makeTurn(1))).rejects.toThrow(/first attempt fails/);
    expect(fs.readFileSync(logPath, 'utf-8')).toBe(original);

    await writer.write(makeTurn(2));

    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(original);
    const parsed = parseLog(fs.readFileSync(logPath, 'utf-8'));
    expect(parsed.sentinel).toBe(true);
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].turnId).toBe('turn-2');
  });
});
