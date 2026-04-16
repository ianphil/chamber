import {
  Brain,
  Eye,
  Globe,
  Layout,
  List,
  Search,
  Sparkles,
  SquarePen,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type WorkEntryTone = 'running' | 'done' | 'error' | 'thinking';

/**
 * Tool-name → icon heuristics. Matches happen in definition order,
 * so more specific patterns should come first. Case-insensitive.
 *
 * Tool names are normalized before matching: CamelCase → snake_case and
 * lowercased, so `WriteFile` matches `write_file`.
 */
const TOOL_ICON_PATTERNS: ReadonlyArray<{ match: RegExp; icon: LucideIcon }> = [
  // Prefix / namespace patterns first — they take precedence over verb matches.
  // Require a separator so bare "view" falls through to the Eye verb pattern.
  { match: /^(lens|view)[._-]/, icon: Layout },
  { match: /^mind[._-]/, icon: Sparkles },
  // Verb patterns.
  { match: /(^|[._-])(fetch|http|web|url|curl)([._-]|$)/, icon: Globe },
  { match: /(^|[._-])(bash|shell|exec|run|terminal|command)([._-]|$)/, icon: Terminal },
  { match: /(^|[._-])(write|edit|create|apply|patch|update)([._-]|$)/, icon: SquarePen },
  { match: /(^|[._-])(read|view|cat|get_?file|open)([._-]|$)/, icon: Eye },
  { match: /(^|[._-])(grep|search|find)([._-]|$)/, icon: Search },
  { match: /(^|[._-])(list|ls|glob|dir)([._-]|$)/, icon: List },
];

function normalizeToolName(name: string): string {
  // CamelCase → snake_case, then lowercase.
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Map a tool name to a Lucide icon via name heuristics.
 * Falls back to the generic Wrench icon.
 */
export function iconForToolName(toolName: string): LucideIcon {
  const normalized = normalizeToolName(toolName);
  for (const { match, icon } of TOOL_ICON_PATTERNS) {
    if (match.test(normalized)) {
      return icon;
    }
  }
  return Wrench;
}

export function iconForReasoning(): LucideIcon {
  return Brain;
}
