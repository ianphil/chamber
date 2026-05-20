import * as fs from 'fs';
import * as path from 'path';

export interface BuildTeamMemoryContextOptions {
  /**
   * Maximum number of decision entries to include (newest first). Default 10.
   */
  maxDecisions?: number;
  /**
   * Soft byte budget for the assembled block. Decisions are dropped
   * oldest-first (within the most-recent slice) until the block fits.
   * Rules are NEVER truncated; if rules alone exceed the budget, the
   * returned block includes all rules and zero decisions. Default 4096.
   */
  maxBytes?: number;
}

const TEAM_DIR_SEGMENTS = ['.chamber', 'team'];
const RULES_FILENAME = 'rules.md';
const DECISIONS_FILENAME = 'decisions.md';
const DEFAULT_MAX_DECISIONS = 10;
const DEFAULT_MAX_BYTES = 4096;

interface DecisionEntry {
  body: string;
}

/**
 * Reads the team-memory files for a mind and returns a single markdown-ish
 * block suitable for prepending to a chat turn. Returns null when there is
 * no team memory to inject (no directory, no files, or both files empty).
 */
export function buildTeamMemoryContext(
  mindPath: string,
  options: BuildTeamMemoryContextOptions = {},
): string | null {
  const maxDecisions = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const teamDir = path.join(mindPath, ...TEAM_DIR_SEGMENTS);
  if (!directoryExists(teamDir)) return null;

  const rules = readFileTrimmed(path.join(teamDir, RULES_FILENAME));
  const decisionsRaw = readFileTrimmed(path.join(teamDir, DECISIONS_FILENAME));

  if (!rules && !decisionsRaw) return null;

  const decisions = parseDecisions(decisionsRaw).slice(-maxDecisions).reverse();

  return assembleBlock(rules, decisions, maxBytes);
}

function directoryExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readFileTrimmed(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
}

/**
 * Splits a decisions journal into entries delimited by H2 headings (`## `).
 * Content before the first heading is treated as a single implicit entry so
 * journals without headings still work. Entries are returned in file order
 * (caller is responsible for choosing slice + direction).
 */
function parseDecisions(content: string): DecisionEntry[] {
  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const entries: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const body = current.join('\n').trim();
    if (body.length > 0) entries.push(body);
    current = [];
  };

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
    }
    current.push(line);
  }
  flush();

  return entries.map((body) => ({ body }));
}

function assembleBlock(
  rules: string,
  decisionsNewestFirst: DecisionEntry[],
  maxBytes: number,
): string {
  const fits = (rulesPart: string, decisionsPart: DecisionEntry[]): { text: string; bytes: number } => {
    const sections: string[] = [];
    if (rulesPart) {
      sections.push(`<rules>\n${rulesPart}\n</rules>`);
    }
    if (decisionsPart.length > 0) {
      const body = decisionsPart.map((d) => d.body).join('\n\n');
      sections.push(`<recent_decisions>\n${body}\n</recent_decisions>`);
    }
    const text = `<team_memory>\n${sections.join('\n\n')}\n</team_memory>`;
    return { text, bytes: Buffer.byteLength(text, 'utf-8') };
  };

  const kept = [...decisionsNewestFirst];
  let assembled = fits(rules, kept);

  // Drop oldest decisions first (within the most-recent slice). With
  // `decisionsNewestFirst` the oldest kept entry is at the end of the array,
  // so we pop from the tail.
  while (assembled.bytes > maxBytes && kept.length > 0) {
    kept.pop();
    assembled = fits(rules, kept);
  }

  return assembled.text;
}
