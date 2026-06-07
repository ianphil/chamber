import type { MindContext } from '@chamber/shared/types';

export const AGENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

/**
 * Resolves an agent's display color. A user-chosen accent (surfaced via the
 * profile summary map) wins; otherwise the agent falls back to a stable
 * position in {@link AGENT_COLORS} keyed by its index in `minds`.
 */
export function agentColor(
  minds: MindContext[],
  mindId: string,
  accentByMindId?: Record<string, { accentColor?: string | null } | undefined>,
): string {
  const accent = accentByMindId?.[mindId]?.accentColor;
  if (accent) return accent;
  const idx = minds.findIndex(m => m.mindId === mindId);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
}

/**
 * Picks black or white text for legibility on a solid hex background, using
 * the WCAG-style relative luminance of the background. Light agent colors
 * (e.g. amber) get black text; dark ones get white. Falls back to white for
 * an unknown/malformed color.
 */
export function readableTextColor(hex?: string): string {
  if (!hex) return '#fff';
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return '#fff';
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}
