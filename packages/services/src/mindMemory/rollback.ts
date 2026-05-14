// Phase 4 — opt-out rollback for the dream daemon. Converts a structured
// (sentinel-prefixed) `log.md` back into freeform markdown and folds in any
// pre-existing `log.legacy.md` content so the user is left with a single
// human-readable file. Designed to run AFTER `MindManager.reloadMind` has
// torn down the writer/observer for the mind, so there's no concurrent
// writer racing the rewrite.

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Logger } from '../logger';
import {
  parseLog,
  type ParsedTurn,
} from './StructuredLogFormat';

const WORKING_MEMORY_DIRNAME = '.working-memory';
const LOG_FILENAME = 'log.md';
const LEGACY_FILENAME = 'log.legacy.md';

export interface RollbackResult {
  /** Number of structured frames successfully converted to unstructured markdown. */
  framesConverted: number;
  /**
   * True if `log.legacy.md` was present (and thus folded into the merged log.md).
   * **Only meaningful when `outcome === 'rolled-back'`** — no-op outcomes always report `false`
   * without checking the filesystem.
   */
  legacyExisted: boolean;
  /**
   * One of:
   *  - `'no-op-missing'` — log.md absent.
   *  - `'no-op-empty'` — log.md present but zero bytes.
   *  - `'no-op-no-sentinel'` — log.md present but not structured (already unstructured).
   *  - `'no-op-malformed'` — log.md has sentinel + non-empty body but parser produced
   *    zero turns (all frames malformed). File is preserved byte-identical to avoid
   *    data loss; toggle is still successful at the config level.
   *  - `'rolled-back'` — log.md was structured and was rewritten.
   */
  outcome: 'no-op-missing' | 'no-op-empty' | 'no-op-no-sentinel' | 'no-op-malformed' | 'rolled-back';
}

export interface RollbackLogger {
  info(message: string): void;
  warn(message: string, ...rest: unknown[]): void;
}

export interface RollbackDeps {
  logger?: RollbackLogger;
  /** Override for tests that need to simulate a rename failure. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Override clock for deterministic merged-section header timestamps in tests. */
  now?: () => Date;
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

async function readOrNull(absPath: string): Promise<string | null> {
  try {
    return await fsp.readFile(absPath, 'utf-8');
  } catch (err) {
    if (isErrnoCode(err, 'ENOENT')) return null;
    throw err;
  }
}

function renderTurnAsMarkdown(turn: ParsedTurn): string {
  // Format approved per plan.md Phase 4 spec:
  //   ## {ISO} — turn {turnId} ({model})
  //   **User**: {prompt}
  //
  //   **Assistant**: {finalAssistantMessage}
  return [
    `## ${turn.timestamp} — turn ${turn.turnId} (${turn.model})`,
    '',
    `**User**: ${turn.prompt}`,
    '',
    `**Assistant**: ${turn.assistant}`,
    '',
  ].join('\n');
}

function composeMergedContent(
  legacyContent: string | null,
  turns: readonly ParsedTurn[],
  resumedAt: string,
): string {
  // Zero-frames sentinel-only rollback: don't emit a "Resumed" header that
  // claims content was resumed when nothing was. Just preserve legacy (or
  // empty file) and let the caller move on.
  if (turns.length === 0) {
    if (legacyContent && legacyContent.length > 0) {
      return legacyContent.endsWith('\n') ? legacyContent : `${legacyContent}\n`;
    }
    return '';
  }

  const renderedFrames = turns.map(renderTurnAsMarkdown).join('\n');
  const resumedSection = `## Resumed unstructured logging — ${resumedAt}\n\n${renderedFrames}`;

  if (legacyContent && legacyContent.length > 0) {
    const legacyTrimmed = legacyContent.endsWith('\n') ? legacyContent.slice(0, -1) : legacyContent;
    return `${legacyTrimmed}\n\n---\n\n${resumedSection}`;
  }

  return resumedSection;
}

export async function rollbackToUnstructured(
  mindPath: string,
  deps: RollbackDeps = {},
): Promise<RollbackResult> {
  const log: RollbackLogger = deps.logger ?? Logger.create('rollbackToUnstructured');
  const rename = deps.rename ?? fsp.rename;
  const now = deps.now ?? (() => new Date());

  const workingMemoryDir = path.resolve(mindPath, WORKING_MEMORY_DIRNAME);
  const logPath = path.join(workingMemoryDir, LOG_FILENAME);
  const legacyPath = path.join(workingMemoryDir, LEGACY_FILENAME);

  const currentContent = await readOrNull(logPath);
  if (currentContent === null) {
    return { framesConverted: 0, legacyExisted: false, outcome: 'no-op-missing' };
  }
  if (currentContent.length === 0) {
    return { framesConverted: 0, legacyExisted: false, outcome: 'no-op-empty' };
  }

  const parsed = parseLog(currentContent);
  if (!parsed.sentinel) {
    log.warn(
      `rollbackToUnstructured: log.md at ${logPath} has no sentinel — already unstructured. Leaving file untouched.`,
    );
    return { framesConverted: 0, legacyExisted: false, outcome: 'no-op-no-sentinel' };
  }

  // Sentinel-with-content-but-no-parseable-frames: preserve the raw file
  // to avoid data loss. The user's chat history is in there (just unparseable);
  // overwriting with an empty file would destroy it. The toggle still
  // succeeds at the config level — this branch only refuses the rewrite.
  if (parsed.turns.length === 0 && parsed.malformed > 0) {
    log.warn(
      `rollbackToUnstructured: log.md at ${logPath} has ${parsed.malformed} malformed frame(s) and no parseable turns. Preserving file as-is to avoid data loss.`,
    );
    return { framesConverted: 0, legacyExisted: false, outcome: 'no-op-malformed' };
  }

  const legacyContent = await readOrNull(legacyPath);
  const legacyExisted = legacyContent !== null;

  const merged = composeMergedContent(legacyContent, parsed.turns, now().toISOString());

  // Atomic rewrite: write to tmp, fsync, rename. If anything fails, the
  // original log.md and log.legacy.md remain byte-identical.
  const tmpPath = `${logPath}.rollback.${process.pid}.${Date.now()}.tmp`;
  const handle = await fsp.open(tmpPath, 'wx');
  try {
    await handle.writeFile(merged, 'utf-8');
    await handle.sync();
  } finally {
    // SF-3: post-sync close is virtually infallible (data is on disk), but a
    // throw here would propagate and skip the rename. Swallow defensively so
    // a phantom close failure doesn't poison a successful write.
    await handle.close().catch(() => { /* fd will be released by GC */ });
  }

  try {
    await rename(tmpPath, logPath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* best-effort */ }
    }
    throw err;
  }

  if (legacyExisted) {
    try {
      await fsp.unlink(legacyPath);
    } catch (err) {
      // Non-fatal — the merged log.md already contains the legacy content.
      // We log so the operator knows the file is orphaned, but we don't
      // re-raise: rollback succeeded from the user's perspective.
      log.warn(`rollbackToUnstructured: failed to remove ${legacyPath} after merge:`, err);
    }
  }

  log.info(
    `rollbackToUnstructured: converted ${parsed.turns.length} frame(s) for ${mindPath}` +
      (legacyExisted ? ' (legacy log folded in)' : ''),
  );

  return {
    framesConverted: parsed.turns.length,
    legacyExisted,
    outcome: 'rolled-back',
  };
}
