import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { MindContext, UserProfile } from '@chamber/shared/types';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { agentColor } from '../chat/agentColors';
import { isModeratorMessage, profileDisplayName } from './chatroomModerator';
import { ModeratorDecisionBubble } from './ModeratorDecisionBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatroomMessageRow } from './ChatroomMessageRow';

// ---------------------------------------------------------------------------
// ChatroomMessageList
// ---------------------------------------------------------------------------

export function ChatroomMessageList({
  messages,
  minds,
  profileByMindId,
  userProfile,
  moderatorMindId,
  activeSpeaker,
  orchestrationMode,
}: {
  messages: ChatroomMessage[];
  minds: MindContext[];
  profileByMindId: Record<string, AgentProfileSummary>;
  userProfile: UserProfile | null;
  moderatorMindId?: string;
  activeSpeaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null;
  orchestrationMode?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef(messages.length);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    isAutoScrolling.current = true;
    setHasNewBelow(false);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;

    // User-just-sent: when the newest message is a user message and the id has
    // changed since last render, override auto-scroll and snap to bottom. User
    // intent is unambiguous on Send -- they want to see what they wrote land.
    const latest = messages[messages.length - 1];
    const isNewUserMessage = latest?.role === 'user' && latest.id !== lastMessageIdRef.current;
    const grewByOne = messages.length > lastMessageCountRef.current;

    if (isNewUserMessage) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      isAutoScrolling.current = true;
      setHasNewBelow(false);
    } else if (isAutoScrolling.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setHasNewBelow(false);
    } else if (grewByOne) {
      // A new agent message arrived while the user was scrolled up. Surface
      // the floating "New messages" pill instead of silently appending.
      setHasNewBelow(true);
    }

    lastMessageIdRef.current = latest?.id ?? null;
    lastMessageCountRef.current = messages.length;
  }, [messages, activeSpeaker]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAutoScrolling.current = nearBottom;
    if (nearBottom && hasNewBelow) setHasNewBelow(false);
  };

  return (
    <div className="chamber-fade-in relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message) => {
            // Moderator routing messages → compact system bubble
            if (moderatorMindId && isModeratorMessage(message, moderatorMindId)) {
              return <ModeratorDecisionBubble key={message.id} message={message} minds={minds} profileByMindId={profileByMindId} />;
            }

            const isUser = message.role === 'user';
            const senderProfile = !isUser && message.sender ? profileByMindId[message.sender.mindId] : undefined;
            const senderName = isUser
              ? (message.sender?.name ?? 'You')
              : profileDisplayName(senderProfile, message.sender?.name ?? 'Unknown');
            const color = isUser ? undefined : agentColor(minds, message.sender?.mindId ?? '', profileByMindId);
            const avatarDataUrl = isUser ? userProfile?.avatarDataUrl : senderProfile?.avatarDataUrl;

            return (
              <ChatroomMessageRow
                key={message.id}
                message={message}
                presenter={{ senderName, color, isUser, avatarDataUrl }}
                animate={message.id === messages[messages.length - 1]?.id}
              />
            );
          })}

          {/* Typing indicator */}
          {activeSpeaker && (
            <TypingIndicator speaker={activeSpeaker} minds={minds} orchestrationMode={orchestrationMode} profileByMindId={profileByMindId} />
          )}
        </div>
      </div>
      {hasNewBelow && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          className="absolute bottom-3 right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown size={13} aria-hidden />
          New messages
        </button>
      )}
    </div>
  );
}
