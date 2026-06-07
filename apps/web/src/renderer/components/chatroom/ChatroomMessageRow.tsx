import React, { memo } from 'react';
import { getPlainContent } from '../../lib/store';
import { cn, formatTime } from '../../lib/utils';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import { AgentAvatar } from '../profile/AgentAvatar';
import { MessageActions } from '../chat/MessageActions';
import { CollapsibleMessage } from './CollapsibleMessage';

// ---------------------------------------------------------------------------
// ChatroomMessageRow
// ---------------------------------------------------------------------------

export interface ChatroomMessagePresenter {
  senderName: string;
  color: string | undefined;
  isUser: boolean;
  avatarDataUrl: string | null | undefined;
}

// Memoized so an inbound message at the end of a long transcript doesn't force
// every prior message subtree (markdown + rehype-highlight + collapsible cells)
// to re-render. content-visibility hint lets the browser skip layout/paint
// work for off-screen rows.
export const ChatroomMessageRow = memo(function ChatroomMessageRow({
  message,
  presenter,
  animate,
}: {
  message: ChatroomMessage;
  presenter: ChatroomMessagePresenter;
  // Only the newest row plays the entry fade. Replaying it on every row when a
  // saved session loads reads as a laggy bulk fade.
  animate: boolean;
}) {
  const { senderName, color, isUser, avatarDataUrl } = presenter;

  return (
    <div
      className={cn('group flex gap-3', animate && 'chamber-fade-in')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '140px' } as React.CSSProperties}
    >
      {/* Avatar */}
      <AgentAvatar
        name={senderName}
        avatarDataUrl={avatarDataUrl}
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0 mt-0.5"
        fallbackClassName={cn(isUser && 'bg-secondary text-secondary-foreground')}
        style={isUser ? undefined : { backgroundColor: color, color: '#fff' }}
        fallback={isUser ? 'Y' : senderName.charAt(0).toUpperCase()}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-sm font-medium"
            style={isUser ? undefined : { color }}
          >
            {senderName}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <>
            <CollapsibleMessage message={message} />
            {!message.isStreaming && getPlainContent(message).trim() && (
              <MessageActions content={getPlainContent(message)} />
            )}
          </>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {getPlainContent(message)}
          </p>
        )}
      </div>
    </div>
  );
});
