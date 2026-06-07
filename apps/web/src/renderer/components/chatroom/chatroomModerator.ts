import { getPlainContent } from '../../lib/store';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { AgentProfileSummary } from '../../lib/store/state';

export function profileDisplayName(profile: AgentProfileSummary | undefined, fallback: string): string {
  return profile?.displayName?.trim() || fallback;
}

// ---------------------------------------------------------------------------
// Moderator message detection & parsing
// ---------------------------------------------------------------------------

export interface ModeratorDecision {
  nextSpeaker: string;
  direction: string;
  action: string;
}

export function parseModeratorJson(text: string): ModeratorDecision | null {
  const match = text.match(/\{[\s\S]*?"next_speaker"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      nextSpeaker: typeof parsed.next_speaker === 'string' ? parsed.next_speaker : '',
      direction: typeof parsed.direction === 'string' ? parsed.direction : '',
      action: typeof parsed.action === 'string' ? parsed.action : 'direct',
    };
  } catch {
    return null;
  }
}

export function isModeratorMessage(message: ChatroomMessage, moderatorMindId?: string): boolean {
  if (message.role !== 'assistant') return false;
  if (moderatorMindId && message.sender?.mindId !== moderatorMindId) return false;
  const text = getPlainContent(message);
  return parseModeratorJson(text) !== null;
}
