/**
 * Date conversion utilities — convert relative date references to absolute ISO dates.
 *
 * Pure module: no I/O, no logging.
 */

interface DatePattern {
  readonly regex: RegExp;
  readonly resolve: (match: RegExpMatchArray, ref: Date) => Date;
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function formatISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const PATTERNS: readonly DatePattern[] = [
  { regex: /\byesterday\b/gi, resolve: (_m, ref) => subtractDays(ref, 1) },
  { regex: /\btoday\b/gi, resolve: (_m, ref) => subtractDays(ref, 0) },
  { regex: /\bthis morning\b/gi, resolve: (_m, ref) => subtractDays(ref, 0) },
  { regex: /\blast week\b/gi, resolve: (_m, ref) => subtractDays(ref, 7) },
  { regex: /\blast month\b/gi, resolve: (_m, ref) => subtractDays(ref, 30) },
  { regex: /\ba few days ago\b/gi, resolve: (_m, ref) => subtractDays(ref, 3) },
  {
    regex: /\b(\d+)\s+days?\s+ago\b/gi,
    resolve: (m, ref) => subtractDays(ref, parseInt(m[1]!, 10)),
  },
];

export function convertRelativeDates(content: string, referenceDate: Date = new Date()): string {
  let result = content;

  for (const pattern of PATTERNS) {
    result = result.replace(pattern.regex, (...args) => {
      const match = args as unknown as RegExpMatchArray;
      const date = pattern.resolve(match, referenceDate);
      return formatISO(date);
    });
  }

  return result;
}

export function parseRelativeDate(text: string, referenceDate: Date): Date | null {
  const trimmed = text.trim();

  for (const pattern of PATTERNS) {
    const rx = new RegExp(pattern.regex.source, pattern.regex.flags);
    const match = rx.exec(trimmed);
    if (match && match[0].length === trimmed.length) {
      return pattern.resolve(match, referenceDate);
    }
  }

  return null;
}
