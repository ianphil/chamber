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
  /**
   * Strict opt-in for the dream-daemon log section. When `true` (the user
   * enabled consolidation in `.chamber.json` or via the agent profile UI),
   * the composer reads `log.md`, validates the sentinel, and includes the
   * last-K turns. When `false` (the default for new minds), the log section
   * is omitted entirely — no read, no info, no warn. Silence is the
   * contract: a freshly-genesis'd mind that hasn't opted in must not yield
   * "log.md is unstructured" tray noise.
   *
   * Threaded through from `IdentityLoader.resolveComposerConfig`, which
   * sources it from `loadChamberMindConfig(mindPath).workingMemory.consolidation.enabled`.
   */
  readonly enabled: boolean;
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

  // Per-instance dedupe of the unstructured-log info line, keyed by mindPath.
  // Lives on the closure so each composer instance gets fresh state — Uncle
  // Bob's plan-review (finding 6) rejected module-scope state because tests
  // would leak between cases. Two opted-in minds with unstructured logs will
  // each get one info line; calling compose() three times for the same mind
  // produces ONE info line.
  const unstructuredWarned = new Set<string>();

  return {
    compose(mindPath, config) {
      const dir = path.join(mindPath, WORKING_MEMORY_DIRNAME);
      if (!safeExists(dir)) return '';

      const sections: string[] = [];

      const memory = readMemory(dir, config.memoryMaxBytes, log);
      if (memory) sections.push(memory);

      const rules = readSimple(dir, 'rules.md');
      if (rules) sections.push(rules);

      // Strict opt-in gate. The log section is omitted entirely when the mind
      // has not enabled dream-daemon consolidation. No read, no info, no warn
      // — see the field doc on WorkingMemoryComposerConfig.enabled.
      if (config.enabled === true) {
        const logSection = readLog(mindPath, dir, config, log, unstructuredWarned);
        if (logSection) sections.push(logSection);
      }

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
  mindPath: string,
  dir: string,
  config: WorkingMemoryComposerConfig,
  log: ComposerLogger,
  unstructuredWarned: Set<string>,
): string {
  const filePath = path.join(dir, 'log.md');
  if (!safeExists(filePath)) return '';

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.warn(`failed to read log.md; skipping log section`, err);
    return '';
  }

  if (raw.trim().length === 0) return '';

  const parsed = parseLog(raw);
  if (!parsed.sentinel) {
    // Migration-window log level: pre-existing minds may still hold an
    // unstructured log.md until DailyLogWriter rotates it on the first turn.
    // Use info (not warn) so SRE dashboards don't flag this benign state.
    // Dedupe per-mindPath so we emit at most one line per process per mind.
    if (!unstructuredWarned.has(mindPath)) {
      unstructuredWarned.add(mindPath);
      log.info(
        `log.md is unstructured (no chamber-structured-log/v1 sentinel); skipping log section`,
      );
    }
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
      `${label} exceeds ${maxBytes}B and the truncation marker alone (${markerBytes}B) does not fit; emitting marker only`,
    );
    return marker.slice(0, maxBytes);
  }

  const room = maxBytes - markerBytes;
  let truncated = s;
  while (Buffer.byteLength(truncated, 'utf-8') > room && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }

  log.info(
    `truncated ${label} from ${originalBytes}B to ${Buffer.byteLength(truncated + marker, 'utf-8')}B`,
  );
  return truncated + marker;
}
