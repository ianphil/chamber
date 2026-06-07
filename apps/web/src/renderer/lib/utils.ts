import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility functions
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Humanize an ISO/parsable timestamp as a compact relative age ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Convert a snake_case key to Title Case (e.g. "inbox_count" → "Inbox Count") */
export function formatTitle(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Matches an ISO 8601 datetime string, e.g. "2026-06-04T09:00:24.110-04:00". */
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** Format an ISO datetime string into a readable local date and time. */
function formatIsoDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format an unknown value for display: arrays joined, objects stringified, ISO dates humanized, nulls -> dash */
export function formatDisplayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  if (typeof value === 'string' && ISO_DATETIME_PATTERN.test(value)) return formatIsoDateTime(value);
  return value == null ? '--' : String(value);
}

export interface SkillContextInjection {
  /** The skill name from the `<skill-context name="...">` wrapper. */
  name: string;
  /** The injected skill body, trimmed of the wrapper. */
  body: string;
}

/**
 * Matches a turn whose entire content is a Copilot SDK skill-context injection,
 * e.g. `<skill-context name="lens">...</skill-context>`. The SDK injects loaded
 * skills as synthetic user-role turns; Chamber should not surface them as
 * authored user messages.
 */
const SKILL_CONTEXT_PATTERN = /^\s*<skill-context\s+name="([^"]+)">([\s\S]*?)<\/skill-context>\s*$/;

/**
 * Parse an SDK skill-context injection out of a message's plain content.
 * Returns null unless the content is, in its entirety, a single skill-context
 * block — so genuine user messages that merely mention the tag are untouched.
 */
export function parseSkillContextInjection(content: string): SkillContextInjection | null {
  const match = content.match(SKILL_CONTEXT_PATTERN);
  if (!match) return null;
  return { name: match[1], body: match[2].trim() };
}
