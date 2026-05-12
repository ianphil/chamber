/**
 * WorkingMemoryComposer — assembles the working-memory section of a mind's
 * system prompt from `<mindPath>/.working-memory/{memory.md, rules.md, log.md}`.
 *
 * Phase 12 scope (locked by plan):
 *   - `memory.md` → full content, hard-capped at `memoryMaxBytes` (defense-in-
 *     depth; the consolidator already caps at write time).
 *   - `rules.md` → full content (small file, no cap).
 *   - `log.md` → only included when the file's first non-blank line is the
 *     `chamber-structured-log/v1` sentinel. The composer takes the last
 *     `lastKTurns` parsed turns and renders each, truncating any rendered
 *     turn that exceeds `perTurnMaxBytes`. Unstructured / missing logs
 *     contribute NOTHING and emit a warning (sentinel detection is owned by
 *     this composer, not by DailyLogWriter — a mind that never ran the
 *     writer must not leak its legacy log into the prompt).
 *   - `log.legacy.md` → never included.
 *
 * Section order: memory → rules → log. Sections are joined by the same
 * `\n\n---\n\n` separator IdentityLoader uses for its top-level parts so
 * the resulting string can be slotted into the system prompt as a single
 * element without disturbing the existing layout.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { Logger } from '../logger';
import {
  parseLog,
  type ParsedTurn,
} from '../mindMemory/StructuredLogFormat';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const SECTION_SEPARATOR = '\n\n---\n\n';

export interface WorkingMemoryComposerConfig {
  /** Max number of structured turns to include from `log.md`. */
  readonly lastKTurns: number;
  /** Max bytes per rendered turn frame; over-budget turns get a truncation marker. */
  readonly perTurnMaxBytes: number;
  /** Hard cap on `memory.md` bytes (defense-in-depth over the consolidator). */
  readonly memoryMaxBytes: number;
}

export interface ComposerLogger {
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
}

export interface WorkingMemoryComposerDeps {
  readonly logger?: ComposerLogger;
}

export interface WorkingMemoryComposer {
  /** Build the working-memory section. Returns `''` when nothing applies. */
  compose(mindPath: string, config: WorkingMemoryComposerConfig): string;
}

export function createWorkingMemoryComposer(
  deps: WorkingMemoryComposerDeps = {},
): WorkingMemoryComposer {
  const log: ComposerLogger = deps.logger ?? Logger.create('WorkingMemoryComposer');

  return {
    compose(mindPath, config) {
      const dir = path.join(mindPath, WORKING_MEMORY_DIRNAME);
      if (!safeExists(dir)) return '';

      const sections: string[] = [];

      const memory = readMemory(dir, config.memoryMaxBytes, log);
      if (memory) sections.push(memory);

      const rules = readSimple(dir, 'rules.md');
      if (rules) sections.push(rules);

      const logSection = readLog(dir, config, log);
      if (logSection) sections.push(logSection);

      return sections.join(SECTION_SEPARATOR);
    },
  };
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readSimple(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  if (!safeExists(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function readMemory(dir: string, maxBytes: number, log: ComposerLogger): string {
  const raw = readSimple(dir, 'memory.md');
  if (!raw) return '';
  return truncateToBytes(raw, maxBytes, log, 'memory.md');
}

function readLog(
  dir: string,
  config: WorkingMemoryComposerConfig,
  log: ComposerLogger,
): string {
  const filePath = path.join(dir, 'log.md');
  if (!safeExists(filePath)) return '';

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`WorkingMemoryComposer: failed to read log.md; skipping log section`, err);
    return '';
  }

  if (raw.trim().length === 0) return '';

  const parsed = parseLog(raw);
  if (!parsed.sentinel) {
    log.warn(
      `WorkingMemoryComposer: log.md is unstructured (no chamber-structured-log/v1 sentinel); skipping log section`,
    );
    return '';
  }

  if (parsed.turns.length === 0) return '';

  const k = Math.max(0, config.lastKTurns | 0);
  if (k === 0) return '';

  const tail = parsed.turns.slice(-k);
  const rendered = tail.map((t) => truncateToBytes(renderTurn(t), config.perTurnMaxBytes, log, `turn ${t.turnId}`));
  return rendered.join('\n\n');
}

function renderTurn(turn: ParsedTurn): string {
  return [
    `## ${turn.timestamp}  turn:${turn.turnId}  status:${turn.status}`,
    `session: ${turn.sessionId}`,
    `model: ${turn.model}`,
    '',
    '### user',
    turn.prompt,
    '',
    '### assistant',
    turn.assistant,
  ].join('\n');
}

function truncateToBytes(
  s: string,
  maxBytes: number,
  log: ComposerLogger,
  label: string,
): string {
  const originalBytes = Buffer.byteLength(s, 'utf-8');
  if (originalBytes <= maxBytes) return s;

  const originalKb = Math.max(1, Math.round(originalBytes / 1024));
  const marker = `\n[…truncated, originally ${originalKb} KB]`;
  const markerBytes = Buffer.byteLength(marker, 'utf-8');

  if (markerBytes >= maxBytes) {
    log.warn(
      `WorkingMemoryComposer: ${label} exceeds ${maxBytes}B and the truncation marker alone (${markerBytes}B) does not fit; emitting marker only`,
    );
    return marker.slice(0, maxBytes);
  }

  const room = maxBytes - markerBytes;
  let truncated = s;
  while (Buffer.byteLength(truncated, 'utf-8') > room && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }

  log.info(
    `WorkingMemoryComposer: truncated ${label} from ${originalBytes}B to ${Buffer.byteLength(truncated + marker, 'utf-8')}B`,
  );
  return truncated + marker;
}
