/**
 * Daily log parsing and memory entry extraction.
 *
 * Pure functions — no file I/O. Content is passed as strings.
 *
 * Ported from SCNS (`scns/src/dream/extraction.ts`) with a Chamber-specific
 * **sensitive-content redaction guard** added (see {@link containsSensitive}):
 * before any extracted line is synthesized into a MemoryEntry, the raw text
 * is screened for credential-shaped substrings (sk-… , AKIA… , ghp_… ,
 * "password is …", "secret = …"). Matches are dropped on the floor — they
 * are NOT memorized, even if the classifier would otherwise accept them.
 */

import { randomUUID } from 'node:crypto';
import type { MemoryEntry } from './memory-entries';
import { deduplicateEntries } from './memory-entries';

export interface DailyLogEntry {
  readonly date: string;
  readonly time: string;
  readonly sessionId: string | null;
  readonly lines: ReadonlyArray<string>;
}

interface Classification {
  readonly type: MemoryEntry['type'];
  readonly confidence: number;
}

const STRONG_CONFIDENCE = 0.9;
const WEAK_CONFIDENCE = 0.6;

type PatternDef = readonly [RegExp, number];

const USER_PATTERNS: readonly PatternDef[] = [
  [/\bprefers?\b/i, STRONG_CONFIDENCE],
  [/\balways wants?\b/i, STRONG_CONFIDENCE],
  [/\blikes?\b/i, WEAK_CONFIDENCE],
  [/\bdislikes?\b/i, STRONG_CONFIDENCE],
  [/\bstyle\b/i, WEAK_CONFIDENCE],
  [/\bconvention\b/i, WEAK_CONFIDENCE],
];

const FEEDBACK_PATTERNS: readonly PatternDef[] = [
  [/\bshould\b/i, WEAK_CONFIDENCE],
  [/\bdon['']t\b/i, STRONG_CONFIDENCE],
  [/\bremember to\b/i, STRONG_CONFIDENCE],
  [/\bbetter to\b/i, STRONG_CONFIDENCE],
  [/\blesson learned\b/i, STRONG_CONFIDENCE],
];

const PROJECT_PATTERNS: readonly PatternDef[] = [
  [/\bdecided\b/i, STRONG_CONFIDENCE],
  [/\busing\b/i, WEAK_CONFIDENCE],
  [/\barchitecture\b/i, STRONG_CONFIDENCE],
  [/\bdatabase\b/i, WEAK_CONFIDENCE],
  [/\bdeployed\b/i, STRONG_CONFIDENCE],
  [/\bconfigured\b/i, WEAK_CONFIDENCE],
];

const REFERENCE_PATTERNS: readonly PatternDef[] = [
  [/\bURL\b/i, STRONG_CONFIDENCE],
  [/\blink\b/i, WEAK_CONFIDENCE],
  [/\bdashboard at\b/i, STRONG_CONFIDENCE],
  [/\bdocs at\b/i, STRONG_CONFIDENCE],
  [/\bAPI at\b/i, STRONG_CONFIDENCE],
  [/\blocated at\b/i, STRONG_CONFIDENCE],
  [/https?:\/\//i, WEAK_CONFIDENCE],
];

const PROHIBITION_PATTERNS: readonly PatternDef[] = [
  [/\bnever (do|claim|say|assume|make|lie|skip|write|mark)\b/i, STRONG_CONFIDENCE],
  [/\bstop (doing|making|saying|lying|claiming|ignoring|skipping)\b/i, STRONG_CONFIDENCE],
  [/\bdo not (ever|again|assume|claim|skip)\b/i, STRONG_CONFIDENCE],
  [/\bmust not\b/i, STRONG_CONFIDENCE],
  [/\bavoid\b.*\b(always|never|must)\b/i, WEAK_CONFIDENCE],
  [/\bnegative feedback\b/i, WEAK_CONFIDENCE],
  [/\bprohibit/i, STRONG_CONFIDENCE],
];

// ---------------------------------------------------------------------------
// Sensitive-content redaction guard (Chamber addition)
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI-style API key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub personal access token
  /\bgho_[A-Za-z0-9]{20,}\b/, // GitHub OAuth token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /\b(?:password|passwd|pwd)\s*(?:is|=|:)\s*\S{3,}/i,
  /\b(?:secret|api[_-]?key|access[_-]?token|auth[_-]?token)\w*\s*(?:is|=|:)\s*\S{8,}/i,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Returns true when the input text contains a credential-shaped substring.
 * Used to drop entries that would otherwise be memorized.
 */
export function containsSensitive(text: string): boolean {
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// parseDailyLog
// ---------------------------------------------------------------------------

const OLD_HEADER_RE = /^###\s+(\d{1,2}:\d{2})(?:\s+[—–-]\s+Session\s+(\S+))?$/;
const PROD_HEADER_RE = /^##\s+(\d{1,2}:\d{2}:\d{2})\s*$/;
const TAGS_RE = /^Tags:\s*(.+)$/;
const CONTENT_RE = /^\*\*\[([^\]]+)\]\*\*\s*(.*)$/;

const NOISE_SOURCES = new Set([
  'pre-tool-use',
  'post-tool-use',
  'tool-use',
  'session-start',
  'session-end',
]);

function parseTags(tagsLine: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of tagsLine.split(',')) {
    const trimmed = part.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value) tags.set(key, value);
  }
  return tags;
}

function stripContentWrapper(content: string): string {
  const wrappers = [
    /^User prompt:\s*/i,
    /^Tool used:\s*/i,
    /^Pre-tool:\s*/i,
    /^Post-tool:\s*/i,
    /^Session\s+\S+\s+(started|ended)\s*/i,
  ];
  for (const re of wrappers) {
    const match = re.exec(content);
    if (match) return content.slice(match[0].length).trim();
  }
  return content;
}

export function parseDailyLog(content: string, date: string): DailyLogEntry[] {
  if (!content.trim()) return [];

  const results: DailyLogEntry[] = [];
  let current: { time: string; sessionId: string | null; lines: string[] } | null = null;
  let currentIsNoise = false;

  const rawLines = content.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trimEnd();

    const oldMatch = OLD_HEADER_RE.exec(line);
    if (oldMatch) {
      if (current && !currentIsNoise) {
        results.push({
          date,
          time: current.time,
          sessionId: current.sessionId,
          lines: current.lines,
        });
      }
      current = { time: oldMatch[1]!, sessionId: oldMatch[2] ?? null, lines: [] };
      currentIsNoise = false;
      continue;
    }

    const prodMatch = PROD_HEADER_RE.exec(line);
    if (prodMatch) {
      if (current && !currentIsNoise) {
        results.push({
          date,
          time: current.time,
          sessionId: current.sessionId,
          lines: current.lines,
        });
      }
      current = { time: prodMatch[1]!, sessionId: null, lines: [] };
      currentIsNoise = false;
      continue;
    }

    if (!current) continue;

    const tagsMatch = TAGS_RE.exec(line);
    if (tagsMatch) {
      const tags = parseTags(tagsMatch[1]!);
      const sessionId = tags.get('session-id');
      if (sessionId && !current.sessionId) {
        current.sessionId = sessionId;
      }
      const source = tags.get('source');
      if (source && NOISE_SOURCES.has(source)) {
        currentIsNoise = true;
        current.lines = [];
      }
      continue;
    }

    const contentMatch = CONTENT_RE.exec(line);
    if (contentMatch) {
      const rawContent = contentMatch[2]!.trim();
      if (rawContent) {
        const stripped = stripContentWrapper(rawContent);
        if (stripped) current.lines.push(stripped);
      }
      continue;
    }

    if (line.startsWith('- ')) {
      current.lines.push(line.slice(2));
      continue;
    }

    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('## ')) {
      current.lines.push(trimmed);
    }
  }

  if (current && !currentIsNoise) {
    results.push({
      date,
      time: current.time,
      sessionId: current.sessionId,
      lines: current.lines,
    });
  }

  return results.filter((e) => e.lines.some((l) => l.trim().length > 0));
}

// ---------------------------------------------------------------------------
// classifyEntry
// ---------------------------------------------------------------------------

export function classifyEntry(line: string): Classification | null {
  const prohibition = matchPatterns(line, PROHIBITION_PATTERNS);
  if (prohibition) return { type: 'prohibition', confidence: prohibition };

  const ref = matchPatterns(line, REFERENCE_PATTERNS);
  if (ref) return { type: 'reference', confidence: ref };

  const user = matchPatterns(line, USER_PATTERNS);
  if (user) return { type: 'user', confidence: user };

  const feedback = matchPatterns(line, FEEDBACK_PATTERNS);
  if (feedback) return { type: 'feedback', confidence: feedback };

  const project = matchPatterns(line, PROJECT_PATTERNS);
  if (project) return { type: 'project', confidence: project };

  return null;
}

function matchPatterns(line: string, patterns: readonly PatternDef[]): number | null {
  let best: number | null = null;
  for (const [regex, confidence] of patterns) {
    if (regex.test(line)) {
      if (best === null || confidence > best) best = confidence;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// generateEntryName
// ---------------------------------------------------------------------------

const FILLER_WORDS = new Set(['the', 'a', 'an']);

export function generateEntryName(content: string): string {
  if (!content.trim()) return '';

  let text = content.replace(/^[-*•]\s+/, '').trim();

  const clauseMatch = /^([^,.\-—–]+)/.exec(text);
  if (clauseMatch) text = clauseMatch[1]!.trim();

  const words = text.split(/\s+/);
  while (words.length > 1 && FILLER_WORDS.has(words[0]!.toLowerCase())) {
    words.shift();
  }

  const titled = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (titled.length <= 60) return titled;
  const truncated = titled.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
}

// ---------------------------------------------------------------------------
// synthesizeEntry
// ---------------------------------------------------------------------------

const TYPO_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bii\b/gi, 'I'],
  [/\bsi\b/gi, 'is'],
  [/\bteh\b/gi, 'the'],
  [/\bidk\b/gi, "I don't know"],
];

const SYNTHESIS_RULES: ReadonlyArray<{
  readonly match: RegExp;
  readonly type: MemoryEntry['type'];
  readonly transform: (text: string) => { name: string; description: string };
}> = [
  {
    match: /\bfollow TDD\b/i,
    type: 'feedback',
    transform: () => ({
      name: 'Follow TDD Workflow',
      description:
        'Always follow Test-Driven Development: write tests first, implement to pass, then verify with both automated and manual testing before declaring work complete.',
    }),
  },
  {
    match: /\bstop\s+(doing|making|ignoring|skipping|lying)\b/i,
    type: 'prohibition',
    transform: (text: string) => {
      if (/test/i.test(text)) {
        return {
          name: 'Never Skip Required Testing',
          description: 'Testing requirements are non-negotiable. Do not skip manual or automated testing steps.',
        };
      }
      return {
        name: 'Follow All Quality Requirements',
        description: 'Follow all stated quality requirements without shortcuts or omissions.',
      };
    },
  },
];

export function fixTypos(text: string): string {
  let result = text;
  for (const [pattern, replacement] of TYPO_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function synthesizeEntry(
  rawText: string,
  type: MemoryEntry['type'],
): { name: string; description: string; content: string } | null {
  // Sensitive-content redaction guard — drop entries that contain credentials.
  if (containsSensitive(rawText)) return null;

  for (const rule of SYNTHESIS_RULES) {
    if (rule.match.test(rawText)) {
      const { name, description } = rule.transform(rawText);
      return { name, description, content: description };
    }
  }

  const cleaned = fixTypos(rawText);

  if (cleaned.length < 15) return null;

  if (type === 'prohibition' || type === 'feedback') {
    const normalized = cleanProhibitionFeedback(cleaned);
    if (normalized) {
      return {
        name: generateEntryName(normalized),
        description: normalized,
        content: normalized,
      };
    }
  }

  return {
    name: generateEntryName(cleaned),
    description: cleaned,
    content: cleaned,
  };
}

function cleanProhibitionFeedback(text: string): string | null {
  let cleaned = text
    .replace(/\?\s*$/g, '.')
    .replace(/^why\s+would\s+you\s+/i, '')
    .replace(/^what\s+gives?\s*/i, '')
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  if (cleaned.length > 0 && !cleaned.endsWith('.')) cleaned += '.';

  return cleaned.length > 10 ? cleaned : null;
}

// ---------------------------------------------------------------------------
// extractFromLog
// ---------------------------------------------------------------------------

export function extractFromLog(content: string, date: string): ReadonlyArray<MemoryEntry> {
  const parsed = parseDailyLog(content, date);
  const entries: MemoryEntry[] = [];

  for (const session of parsed) {
    for (const line of session.lines) {
      // Redaction guard fires before classification — sensitive lines never
      // get a chance to match a pattern.
      if (containsSensitive(line)) continue;

      const classification = classifyEntry(line);
      if (!classification) continue;

      const time = session.time.includes(':')
        ? session.time.split(':').length === 3
          ? session.time
          : `${session.time}:00`
        : `${session.time}:00`;

      const synthesized = synthesizeEntry(line, classification.type);
      if (!synthesized) continue;

      entries.push({
        id: randomUUID(),
        type: classification.type,
        name: synthesized.name,
        description: synthesized.description,
        content: synthesized.content,
        source: `daily-log:${date}`,
        createdAt: `${date}T${time}Z`,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// extractFromMultipleLogs
// ---------------------------------------------------------------------------

export function extractFromMultipleLogs(
  logs: ReadonlyArray<{ content: string; date: string }>,
): ReadonlyArray<MemoryEntry> {
  const allEntries: MemoryEntry[] = [];

  for (const log of logs) {
    allEntries.push(...extractFromLog(log.content, log.date));
  }

  allEntries.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  return deduplicateEntries(allEntries);
}
