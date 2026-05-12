import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createWorkingMemoryComposer, type WorkingMemoryComposerConfig } from './WorkingMemoryComposer';
import { STRUCTURED_LOG_SENTINEL, serializeTurn, type CompletedTurn } from '../mindMemory/StructuredLogFormat';

const DEFAULTS: WorkingMemoryComposerConfig = {
  lastKTurns: 10,
  perTurnMaxBytes: 2048,
  memoryMaxBytes: 8192,
};

let mindRoot: string;
let workingMemoryDir: string;

beforeEach(() => {
  mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-wmc-'));
  workingMemoryDir = path.join(mindRoot, '.working-memory');
  fs.mkdirSync(workingMemoryDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(mindRoot, { recursive: true, force: true });
});

function makeTurn(i: number, overrides: Partial<CompletedTurn> = {}): CompletedTurn {
  const ts = `2026-05-12T17:${String(20 + i).padStart(2, '0')}:00Z`;
  return {
    turnId: `turn-${i}`,
    sessionId: `sess-${i}`,
    model: 'claude-opus-4.7',
    status: 'completed',
    startedAt: ts,
    endedAt: ts,
    prompt: `prompt body ${i}`,
    finalAssistantMessage: `assistant body ${i}`,
    ...overrides,
  };
}

function writeStructuredLog(turns: CompletedTurn[]): void {
  const body = STRUCTURED_LOG_SENTINEL + '\n\n' + turns.map(serializeTurn).join('\n');
  fs.writeFileSync(path.join(workingMemoryDir, 'log.md'), body, 'utf-8');
}

describe('WorkingMemoryComposer.compose', () => {
  it('returns empty string when working-memory dir is empty', () => {
    const composer = createWorkingMemoryComposer();
    expect(composer.compose(mindRoot, DEFAULTS)).toBe('');
  });

  it('returns empty string when working-memory dir is missing', () => {
    fs.rmSync(workingMemoryDir, { recursive: true, force: true });
    const composer = createWorkingMemoryComposer();
    expect(composer.compose(mindRoot, DEFAULTS)).toBe('');
  });

  it('includes only rules.md when memory and log are absent', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'rules.md'), 'Operational rule', 'utf-8');
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, DEFAULTS);
    expect(out).toContain('Operational rule');
    expect(out).not.toContain('---');
  });

  it('includes memory.md and rules.md joined by separator', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), 'Curated memory', 'utf-8');
    fs.writeFileSync(path.join(workingMemoryDir, 'rules.md'), 'Operational rule', 'utf-8');
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, DEFAULTS);
    expect(out).toBe('Curated memory\n\n---\n\nOperational rule');
  });

  it('returns only the last K structured turns when log has more than K', () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i));
    writeStructuredLog(turns);
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, { ...DEFAULTS, lastKTurns: 5 });
    expect(out).toContain('turn:turn-14');
    expect(out).toContain('turn:turn-10');
    expect(out).not.toContain('turn:turn-9');
    expect(out).not.toContain('turn:turn-0');
  });

  it('returns all turns when log has fewer than K', () => {
    writeStructuredLog([makeTurn(0), makeTurn(1)]);
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, { ...DEFAULTS, lastKTurns: 10 });
    expect(out).toContain('turn:turn-0');
    expect(out).toContain('turn:turn-1');
  });

  it('truncates a turn whose rendered size exceeds perTurnMaxBytes', () => {
    const huge = 'x'.repeat(10_000);
    writeStructuredLog([makeTurn(0, { finalAssistantMessage: huge })]);
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, { ...DEFAULTS, perTurnMaxBytes: 512 });
    // The rendered turn (or its truncation block) must not exceed the cap by more than a small margin.
    // We assert two things:
    // 1) The full huge body is NOT present verbatim.
    expect(out).not.toContain(huge);
    // 2) A truncation marker is present.
    expect(out).toMatch(/truncated/);
  });

  it('omits log entirely when log.md is unstructured (no sentinel) and warns', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'log.md'), 'just freeform notes\nnot structured\n', 'utf-8');
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), 'mem', 'utf-8');
    const warn = vi.fn();
    const composer = createWorkingMemoryComposer({ logger: { warn, info: () => {} } });
    const out = composer.compose(mindRoot, DEFAULTS);
    expect(out).toBe('mem');
    expect(out).not.toContain('freeform');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/unstructured/i);
  });

  it('contributes nothing when log.md is missing', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), 'mem', 'utf-8');
    const composer = createWorkingMemoryComposer();
    expect(composer.compose(mindRoot, DEFAULTS)).toBe('mem');
  });

  it('never includes log.legacy.md content', () => {
    writeStructuredLog([makeTurn(0)]);
    fs.writeFileSync(
      path.join(workingMemoryDir, 'log.legacy.md'),
      'LEGACY-CONTENT-MUST-NOT-APPEAR',
      'utf-8',
    );
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, DEFAULTS);
    expect(out).not.toContain('LEGACY-CONTENT-MUST-NOT-APPEAR');
    expect(out).toContain('turn:turn-0');
  });

  it('truncates memory.md when it exceeds memoryMaxBytes', () => {
    const huge = 'm'.repeat(20_000);
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), huge, 'utf-8');
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, { ...DEFAULTS, memoryMaxBytes: 1024 });
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(1024 + 100); // marker tolerance
    expect(out).toMatch(/truncated/);
  });

  it('does not throw when memory.md, rules.md, and log.md are all missing', () => {
    const composer = createWorkingMemoryComposer();
    expect(() => composer.compose(mindRoot, DEFAULTS)).not.toThrow();
    expect(composer.compose(mindRoot, DEFAULTS)).toBe('');
  });

  it('respects custom lastKTurns from config', () => {
    const turns = Array.from({ length: 8 }, (_, i) => makeTurn(i));
    writeStructuredLog(turns);
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, { ...DEFAULTS, lastKTurns: 3 });
    expect(out).toContain('turn:turn-7');
    expect(out).toContain('turn:turn-6');
    expect(out).toContain('turn:turn-5');
    expect(out).not.toContain('turn:turn-4');
  });

  it('orders sections memory → rules → log', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), 'MEMSECTION', 'utf-8');
    fs.writeFileSync(path.join(workingMemoryDir, 'rules.md'), 'RULESECTION', 'utf-8');
    writeStructuredLog([makeTurn(0)]);
    const composer = createWorkingMemoryComposer();
    const out = composer.compose(mindRoot, DEFAULTS);
    const memIdx = out.indexOf('MEMSECTION');
    const ruleIdx = out.indexOf('RULESECTION');
    const logIdx = out.indexOf('turn:turn-0');
    expect(memIdx).toBeGreaterThanOrEqual(0);
    expect(ruleIdx).toBeGreaterThan(memIdx);
    expect(logIdx).toBeGreaterThan(ruleIdx);
  });

  it('skips empty/whitespace-only files', () => {
    fs.writeFileSync(path.join(workingMemoryDir, 'memory.md'), '   \n\n', 'utf-8');
    fs.writeFileSync(path.join(workingMemoryDir, 'rules.md'), 'rules-content', 'utf-8');
    const composer = createWorkingMemoryComposer();
    expect(composer.compose(mindRoot, DEFAULTS)).toBe('rules-content');
  });
});
