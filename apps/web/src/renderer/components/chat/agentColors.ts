import type { MindContext } from '@chamber/shared/types';

export const AGENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function agentColor(minds: MindContext[], mindId: string): string {
  const idx = minds.findIndex(m => m.mindId === mindId);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
}
