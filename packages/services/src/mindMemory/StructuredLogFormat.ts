/**
 * Structured log format (chamber-structured-log/v1) — pure serializer + parser.
 *
 * A mind's `<mindPath>/.working-memory/log.md` is migrated to a structured form
 * whose first non-blank line is the magic sentinel below. Each completed turn
 * is appended as a self-delimited frame so the Dream Daemon can consume the
 * log deterministically.
 *
 * Phase 2 scope (locked by plan): pure module only. No fs, no Electron, no
 * Logger. Operates on strings in / strings out. Byte-budget truncation lives
 * on `DailyLogWriter` (Phase 5).
 *
 * Frame format:
 *
 *   <!-- chamber-structured-log/v1 -->
 *   ## <ISO-8601 UTC>  turn:<turn-uuid>  status:<completed|aborted|error>
 *   session: <sdk-session-id>
 *   model: <model-id>
 *
 *   ### user
 *   <prompt body>
 *
 *   ### assistant
 *   <final assistant text>
 *
 * Heading separator: TWO spaces between `## <ts>` and `turn:<uuid>` and
 * between `turn:<uuid>` and `status:<status>` are required.
 *
 * Embedded heading escape strategy:
 * - The turn-heading regex anchors to line start AND requires the trailing
 *   `turn:<uuid>  status:<status>` pair. Plain `## something` lines inside a
 *   body therefore parse as content, not as new turns.
 * - The body-section markers `### user` and `### assistant` are recognised
 *   only when they (a) appear on their own line at column 0 AND (b) are
 *   immediately preceded by a blank line. Inline text such as
 *   `see ### user mode docs` or `## a markdown heading` round-trips fine.
 *   Pathological round-trips of bodies whose own content contains a
 *   blank-line-then-`### user|assistant` sequence are out of scope; callers
 *   producing such content must escape it themselves.
 *
 * The parser is deliberately tolerant: malformed blocks are dropped and
 * counted, never thrown over, so a partially-corrupt log never blocks the
 * daemon.
 */

export const STRUCTURED_LOG_SENTINEL = '<!-- chamber-structured-log/v1 -->';

// `CompletedTurn` and `TurnStatus` were relocated to `@chamber/shared` in
// Phase 6 so ChatService (the producer) and DailyLogWriter (the first
// consumer) depend on a single canonical shape. Re-exported here for
// backward compatibility with Phase 5 callers that import from this module.
export type { CompletedTurn, TurnStatus } from '@chamber/shared/turn-observer';
import type { CompletedTurn, TurnStatus } from '@chamber/shared/turn-observer';

export interface ParsedTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly model: string;
  readonly status: TurnStatus;
  readonly timestamp: string;
  readonly prompt: string;
  readonly assistant: string;
}

export interface ParsedLog {
  readonly sentinel: boolean;
  readonly turns: ParsedTurn[];
  readonly malformed: number;
}

const HEADING_RE = /^## (\S+) {2}turn:(\S+) {2}status:(\S+)$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const STATUS_VALUES: ReadonlySet<string> = new Set<TurnStatus>([
  'completed',
  'aborted',
  'error',
]);

function normalize(content: string): string {
  let s = content;
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
  }
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function firstNonBlankLine(lines: readonly string[]): { idx: number; value: string } | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      return { idx: i, value: lines[i] };
    }
  }
  return null;
}

export function detectSentinel(content: string): boolean {
  const lines = normalize(content).split('\n');
  const first = firstNonBlankLine(lines);
  return first !== null && first.value === STRUCTURED_LOG_SENTINEL;
}

export function serializeTurn(turn: CompletedTurn): string {
  const heading = `## ${turn.endedAt}  turn:${turn.turnId}  status:${turn.status}`;
  return (
    heading +
    '\n' +
    `session: ${turn.sessionId}\n` +
    `model: ${turn.model}\n` +
    '\n' +
    '### user\n' +
    turn.prompt +
    '\n' +
    '\n' +
    '### assistant\n' +
    turn.finalAssistantMessage +
    '\n'
  );
}

function parseBlock(blockLines: readonly string[]): ParsedTurn | null {
  if (blockLines.length === 0) return null;

  const headingMatch = blockLines[0].match(HEADING_RE);
  if (!headingMatch) return null;
  const [, ts, turnId, statusRaw] = headingMatch;

  if (!ISO_UTC_RE.test(ts) || Number.isNaN(Date.parse(ts))) return null;
  if (!STATUS_VALUES.has(statusRaw)) return null;
  const status = statusRaw as TurnStatus;

  if (blockLines.length < 3) return null;
  const sessionMatch = blockLines[1].match(/^session: (.+)$/);
  const modelMatch = blockLines[2].match(/^model: (.+)$/);
  if (!sessionMatch || !modelMatch) return null;
  const sessionId = sessionMatch[1];
  const model = modelMatch[1];

  // `### user` must appear at column 0, preceded by a blank line. Earliest
  // possible position is index 4: heading(0), session(1), model(2), blank(3).
  let userIdx = -1;
  for (let i = 4; i < blockLines.length; i++) {
    if (blockLines[i] === '### user' && blockLines[i - 1] === '') {
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1) return null;

  let assistantIdx = -1;
  for (let i = userIdx + 2; i < blockLines.length; i++) {
    if (blockLines[i] === '### assistant' && blockLines[i - 1] === '') {
      assistantIdx = i;
      break;
    }
  }
  if (assistantIdx === -1) return null;

  const userBodyLines = blockLines.slice(userIdx + 1, assistantIdx);
  const assistantBodyLines = blockLines.slice(assistantIdx + 1);

  // Trim a single trailing blank line introduced by the serializer's
  // section terminator on the user body, and any trailing blanks on the
  // assistant body produced by concatenated turns or the final newline.
  while (userBodyLines.length > 0 && userBodyLines[userBodyLines.length - 1] === '') {
    userBodyLines.pop();
  }
  while (
    assistantBodyLines.length > 0 &&
    assistantBodyLines[assistantBodyLines.length - 1] === ''
  ) {
    assistantBodyLines.pop();
  }

  return {
    turnId,
    sessionId,
    model,
    status,
    timestamp: ts,
    prompt: userBodyLines.join('\n'),
    assistant: assistantBodyLines.join('\n'),
  };
}

export function parseLog(content: string): ParsedLog {
  const lines = normalize(content).split('\n');
  const first = firstNonBlankLine(lines);
  if (first === null || first.value !== STRUCTURED_LOG_SENTINEL) {
    return { sentinel: false, turns: [], malformed: 0 };
  }

  const headingIdxs: number[] = [];
  for (let i = first.idx + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      headingIdxs.push(i);
    }
  }

  const turns: ParsedTurn[] = [];
  let malformed = 0;
  for (let h = 0; h < headingIdxs.length; h++) {
    const blockStart = headingIdxs[h];
    const blockEnd = h + 1 < headingIdxs.length ? headingIdxs[h + 1] : lines.length;
    const parsed = parseBlock(lines.slice(blockStart, blockEnd));
    if (parsed === null) {
      malformed += 1;
    } else {
      turns.push(parsed);
    }
  }

  return { sentinel: true, turns, malformed };
}
