import { useState } from 'react';
import { getPlainContent } from '../../lib/store';
import { StreamingMessage } from '../chat/StreamingMessage';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';

// ---------------------------------------------------------------------------
// CollapsibleMessage — completed agent messages render in full; the user may
// manually collapse a long one into a one-line summary.
// ---------------------------------------------------------------------------

export function CollapsibleMessage({ message }: { message: ChatroomMessage }) {
  const plainText = getPlainContent(message);
  const isLong = plainText.length > 300;
  const isComplete = !message.isStreaming;
  // Never auto-collapse: agent replies stay fully visible until the user
  // chooses to collapse them. Auto-collapsing hid the substance of replies
  // behind an unrepresentative first sentence.
  const [collapsed, setCollapsed] = useState(false);

  if (!collapsed) {
    return (
      <div>
        <StreamingMessage blocks={message.blocks} isStreaming={message.isStreaming} />
        {isLong && isComplete && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-xs text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
            Collapse
          </button>
        )}
      </div>
    );
  }

  // Collapsed view: show first sentence as summary
  const firstSentence = plainText.replace(/^[*#\s]+/, '').split(/[.!?\n]/)[0]?.trim() ?? '';
  const summary = firstSentence.length > 120 ? firstSentence.slice(0, 120) + '…' : firstSentence;
  const toolCount = message.blocks.filter((b) => b.type === 'tool_call').length;

  return (
    <div
      className="border border-border rounded-md px-3 py-2 bg-secondary/30 cursor-pointer hover:bg-secondary/40 transition-colors"
      onClick={() => setCollapsed(false)}
    >
      <div className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0"><polyline points="6 9 12 15 18 9"/></svg>
        <span className="text-sm text-foreground truncate">{summary || 'View response'}</span>
        {toolCount > 0 && (
          <span className="text-xs text-foreground/60 shrink-0">({toolCount} tool call{toolCount > 1 ? 's' : ''})</span>
        )}
      </div>
    </div>
  );
}
