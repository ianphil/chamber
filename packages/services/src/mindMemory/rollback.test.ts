import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  STRUCTURED_LOG_SENTINEL,
  serializeTurn,
  type CompletedTurn,
} from './StructuredLogFormat';
import { rollbackToUnstructured } from './rollback';

const WORKING_MEMORY = '.working-memory';
const LOG_FILE = 'log.md';
const LEGACY_FILE = 'log.legacy.md';

function turnAt(seq: number): CompletedTurn {
  return {
    turnId: `turn-${seq}`,
    sessionId: `session-${seq}`,
    model: 'gpt-test',
    status: 'completed',
    startedAt: `2026-04-${String(seq).padStart(2, '0')}T11:59:00.000Z`,
    endedAt: `2026-04-${String(seq).padStart(2, '0')}T12:00:00.000Z`,
    prompt: `User prompt #${seq}`,
    finalAssistantMessage: `Assistant reply #${seq}`,
  };
}

describe('rollbackToUnstructured', () => {
  let tmpDir: string;
  let workingMemoryDir: string;
  let logPath: string;
  let legacyPath: string;
  const fixedNow = new Date('2026-04-15T08:00:00.000Z');
  const captured: string[] = [];
  const testLogger = {
    info: (m: string) => captured.push(`INFO ${m}`),
    warn: (m: string) => captured.push(`WARN ${m}`),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-rollback-'));
    workingMemoryDir = path.join(tmpDir, WORKING_MEMORY);
    fs.mkdirSync(workingMemoryDir, { recursive: true });
    logPath = path.join(workingMemoryDir, LOG_FILE);
    legacyPath = path.join(workingMemoryDir, LEGACY_FILE);
    captured.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedStructuredLog(turns: readonly CompletedTurn[]): void {
    const body = turns.map(serializeTurn).join('');
    fs.writeFileSync(logPath, `${STRUCTURED_LOG_SENTINEL}\n\n${body}`, 'utf-8');
  }

  it('converts N structured frames into rendered markdown and removes the sentinel', async () => {
    seedStructuredLog([turnAt(1), turnAt(2), turnAt(3)]);

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow });

    expect(result).toEqual({
      framesConverted: 3,
      legacyExisted: false,
      outcome: 'rolled-back',
    });

    const after = fs.readFileSync(logPath, 'utf-8');
    expect(after).not.toContain(STRUCTURED_LOG_SENTINEL);
    expect(after).toContain('## Resumed unstructured logging — 2026-04-15T08:00:00.000Z');
    expect(after).toContain('## 2026-04-01T12:00:00.000Z — turn turn-1 (gpt-test)');
    expect(after).toContain('**User**: User prompt #1');
    expect(after).toContain('**Assistant**: Assistant reply #1');
    expect(after).toContain('**User**: User prompt #3');
    expect(after).toContain('**Assistant**: Assistant reply #3');
  });

  it('folds existing log.legacy.md content into the merged output and removes the legacy file', async () => {
    fs.writeFileSync(legacyPath, '# Legacy notes\n\nFirst-ever line.\n', 'utf-8');
    seedStructuredLog([turnAt(7)]);

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow, logger: testLogger });

    expect(result).toEqual({
      framesConverted: 1,
      legacyExisted: true,
      outcome: 'rolled-back',
    });

    const after = fs.readFileSync(logPath, 'utf-8');
    expect(after.startsWith('# Legacy notes\n\nFirst-ever line.')).toBe(true);
    expect(after).toContain('---');
    expect(after).toContain('## Resumed unstructured logging');
    expect(after).toContain('**User**: User prompt #7');
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('is a no-op when log.md is missing', async () => {
    const result = await rollbackToUnstructured(tmpDir);
    expect(result).toEqual({
      framesConverted: 0,
      legacyExisted: false,
      outcome: 'no-op-missing',
    });
  });

  it('is a no-op when log.md is present but empty', async () => {
    fs.writeFileSync(logPath, '', 'utf-8');
    const result = await rollbackToUnstructured(tmpDir);
    expect(result).toEqual({
      framesConverted: 0,
      legacyExisted: false,
      outcome: 'no-op-empty',
    });
    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
  });

  it('warns and leaves the file untouched when log.md has no sentinel (already unstructured)', async () => {
    const original = '# Already unstructured\n\nUser said something.\n';
    fs.writeFileSync(logPath, original, 'utf-8');

    const result = await rollbackToUnstructured(tmpDir, { logger: testLogger });

    expect(result).toEqual({
      framesConverted: 0,
      legacyExisted: false,
      outcome: 'no-op-no-sentinel',
    });
    expect(fs.readFileSync(logPath, 'utf-8')).toBe(original);
    expect(captured.some((m) => m.startsWith('WARN') && /no sentinel/.test(m))).toBe(true);
  });

  it('is idempotent — calling rollback twice yields the same content (second call is no-op-no-sentinel)', async () => {
    seedStructuredLog([turnAt(1), turnAt(2)]);

    await rollbackToUnstructured(tmpDir, { now: () => fixedNow });
    const afterFirst = fs.readFileSync(logPath, 'utf-8');

    const second = await rollbackToUnstructured(tmpDir, { now: () => fixedNow, logger: testLogger });

    expect(second.outcome).toBe('no-op-no-sentinel');
    expect(fs.readFileSync(logPath, 'utf-8')).toBe(afterFirst);
  });

  it('Flow 4 regression: empty-model frame round-trips through rollback without data loss', async () => {
    const turn: CompletedTurn = {
      turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionId: 'sess-empty-model',
      model: '',
      status: 'completed',
      startedAt: '2026-04-01T11:59:00.000Z',
      endedAt: '2026-04-01T12:00:00.000Z',
      prompt: 'Important user content',
      finalAssistantMessage: 'Important assistant content',
    };
    const raw = `${STRUCTURED_LOG_SENTINEL}\n\n${serializeTurn(turn)}`;
    fs.writeFileSync(logPath, raw, 'utf-8');

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow });

    expect(result.outcome).toBe('rolled-back');
    expect(result.framesConverted).toBe(1);
    const after = fs.readFileSync(logPath, 'utf-8');
    expect(after).toContain('Important user content');
    expect(after).toContain('Important assistant content');
    expect(after).not.toContain(STRUCTURED_LOG_SENTINEL);
  });

  it('preserves log.md unchanged when sentinel is present but all frames are malformed (no-op-malformed)', async () => {
    const malformedFrame =
      '## not-a-date  turn:11111111-1111-4111-8111-111111111111  status:completed\n' +
      'session: s\nmodel: m\n\n### user\nq\n\n### assistant\na\n';
    const original = `${STRUCTURED_LOG_SENTINEL}\n\n${malformedFrame}`;
    fs.writeFileSync(logPath, original, 'utf-8');

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow, logger: testLogger });

    expect(result.outcome).toBe('no-op-malformed');
    expect(result.framesConverted).toBe(0);
    expect(fs.readFileSync(logPath, 'utf-8')).toBe(original);
    expect(captured.some((m) => m.startsWith('WARN') && /malformed/.test(m))).toBe(true);
  });

  it('atomicity: simulated rename failure leaves log.md and log.legacy.md byte-equal to prior state', async () => {
    fs.writeFileSync(legacyPath, 'legacy bytes', 'utf-8');
    seedStructuredLog([turnAt(5)]);
    const beforeLog = fs.readFileSync(logPath, 'utf-8');
    const beforeLegacy = fs.readFileSync(legacyPath, 'utf-8');

    const failingRename = async () => { throw new Error('synthetic rename failure'); };

    await expect(
      rollbackToUnstructured(tmpDir, { now: () => fixedNow, rename: failingRename }),
    ).rejects.toThrow(/synthetic rename failure/);

    expect(fs.readFileSync(logPath, 'utf-8')).toBe(beforeLog);
    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe(beforeLegacy);
    const lingering = fs.readdirSync(workingMemoryDir).filter((entry) => entry.endsWith('.tmp'));
    expect(lingering).toEqual([]);
  });

  it('zero-frames sentinel-only log rolls back to legacy content alone (no spurious "Resumed" header)', async () => {
    fs.writeFileSync(legacyPath, 'pre-existing legacy notes', 'utf-8');
    fs.writeFileSync(logPath, `${STRUCTURED_LOG_SENTINEL}\n\n`, 'utf-8');

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow });

    expect(result).toEqual({
      framesConverted: 0,
      legacyExisted: true,
      outcome: 'rolled-back',
    });

    const after = fs.readFileSync(logPath, 'utf-8');
    expect(after).not.toContain('Resumed unstructured logging');
    expect(after).toContain('pre-existing legacy notes');
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('zero-frames sentinel-only log with no legacy yields an empty log.md (no spurious header)', async () => {
    fs.writeFileSync(logPath, `${STRUCTURED_LOG_SENTINEL}\n\n`, 'utf-8');

    const result = await rollbackToUnstructured(tmpDir, { now: () => fixedNow });

    expect(result).toEqual({
      framesConverted: 0,
      legacyExisted: false,
      outcome: 'rolled-back',
    });
    expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
  });
});
