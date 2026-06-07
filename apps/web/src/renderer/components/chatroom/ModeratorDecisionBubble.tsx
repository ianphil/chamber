import { getPlainContent } from '../../lib/store';
import type { MindContext } from '@chamber/shared/types';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { agentColor } from '../chat/agentColors';
import { parseModeratorJson } from './chatroomModerator';

// ---------------------------------------------------------------------------
// ModeratorDecisionBubble — compact system message for moderator routing
// ---------------------------------------------------------------------------

export function ModeratorDecisionBubble({ message, minds, profileByMindId }: { message: ChatroomMessage; minds: MindContext[]; profileByMindId: Record<string, AgentProfileSummary> }) {
  const text = getPlainContent(message);
  const decision = parseModeratorJson(text);
  if (!decision) return null;

  const color = agentColor(minds, message.sender?.mindId ?? '', profileByMindId);
  const moderatorName = message.sender?.name ?? 'Moderator';

  if (decision.action === 'close') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted-foreground bg-secondary/50 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span style={{ color }}>{moderatorName}</span> closed the discussion
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-center py-2">
      <span className="text-xs text-muted-foreground bg-secondary/50 rounded-full px-3 py-1 inline-flex items-center gap-1.5 max-w-lg">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span style={{ color }}>{moderatorName}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-foreground">{decision.nextSpeaker}</span>
        {decision.direction && (
          <span className="text-muted-foreground truncate">— {decision.direction}</span>
        )}
      </span>
    </div>
  );
}
