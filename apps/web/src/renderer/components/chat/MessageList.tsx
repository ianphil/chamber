import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { MessageActions } from './MessageActions';
import { useAppState, getPlainContent } from '../../lib/store';
import { StreamingMessage } from './StreamingMessage';
import { cn, formatTime, parseSkillContextInjection } from '../../lib/utils';
import type { ChatMessage, MindContext } from '@chamber/shared/types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { AgentAvatar } from '../profile/AgentAvatar';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { useUserProfile } from '../../hooks/useUserProfile';
import { agentColor, readableTextColor } from './agentColors';

function displayName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function profileName(profile: AgentProfileSummary | undefined, fallback: string): string {
  return displayName(profile?.displayName ?? fallback, fallback);
}

function messagePresenter(
  message: ChatMessage,
  agentName: string,
  minds: MindContext[],
  profileByMindId: Record<string, AgentProfileSummary>,
) {
  if (message.role === 'assistant') {
    const name = displayName(agentName, 'Agent');
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: undefined,
      isAgentSender: false,
      avatarDataUrl: undefined,
    };
  }

  if (message.sender && message.sender.mindId !== 'user') {
    const profile = profileByMindId[message.sender.mindId];
    const name = profileName(profile, displayName(message.sender.name, 'Unknown Agent'));
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: agentColor(minds, message.sender.mindId, profileByMindId),
      isAgentSender: true,
      avatarDataUrl: profile?.avatarDataUrl,
    };
  }

  return {
    name: 'You',
    initial: 'Y',
    color: undefined,
    isAgentSender: false,
    avatarDataUrl: undefined,
  };
}

export function MessageList() {
  const { messagesByMind, activeMindId, minds } = useAppState();
  const profileByMindId = useMindProfiles(minds);
  const userProfile = useUserProfile();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const activeMind = minds.find(m => m.mindId === activeMindId);
  const activeProfile = activeMind ? profileByMindId[activeMind.mindId] : undefined;
  const agentName = activeMind ? profileName(activeProfile, activeMind.identity.name) : 'Agent';
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const lastMessageCountRef = useRef(messages.length);

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
      // New assistant message arrived while the user was scrolled up. Surface
      // the floating "New messages" pill instead of silently appending.
      setHasNewBelow(true);
    }

    lastMessageIdRef.current = latest?.id ?? null;
    lastMessageCountRef.current = messages.length;
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Auto-scroll if within 100px of bottom
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAutoScrolling.current = nearBottom;
    if (nearBottom && hasNewBelow) setHasNewBelow(false);
  };

  return (
    <div className="chamber-fade-in relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message) => {
            const presenter = messagePresenter(message, agentName, minds, profileByMindId);
            const avatarDataUrl = message.role === 'assistant'
              ? activeProfile?.avatarDataUrl
              : presenter.isAgentSender
                ? presenter.avatarDataUrl
                : userProfile?.avatarDataUrl;

            return (
              <MessageRow
                key={message.id}
                message={message}
                presenter={presenter}
                avatarDataUrl={avatarDataUrl}
                animate={message.id === messages[messages.length - 1]?.id}
                launch={message.id === messages[messages.length - 1]?.id && message.role === 'user'}
              />
            );
          })}
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

interface MessagePresenter {
  name: string;
  initial: string;
  color: string | undefined;
  isAgentSender: boolean;
  avatarDataUrl: string | null | undefined;
}

interface MessageRowProps {
  message: ChatMessage;
  presenter: MessagePresenter;
  avatarDataUrl: string | null | undefined;
  // Only the newest row plays the entry fade. Replaying it on every row when a
  // saved conversation loads reads as a laggy bulk fade.
  animate: boolean;
  // The newest row when it is the user's just-sent message: plays the launch
  // entrance instead of the generic fade.
  launch: boolean;
}

// Memoized so an inbound message at the end of a long transcript doesn't force
// every prior message subtree (markdown + rehype-highlight + work-group cells)
// to re-render. content-visibility hint lets the browser skip layout/paint
// work for off-screen rows.
const MessageRow = memo(function MessageRow({ message, presenter, avatarDataUrl, animate, launch }: MessageRowProps) {
  return (
    <div
      className={cn('group flex gap-3', launch ? 'chamber-launch' : animate && 'chamber-fade-in')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '140px' } as React.CSSProperties}
    >
      <AgentAvatar
        name={presenter.name}
        avatarDataUrl={avatarDataUrl}
        className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-sm font-medium shrink-0"
        fallbackClassName={cn(
          message.role === 'assistant' ? 'bg-genesis text-primary-foreground' : 'bg-secondary text-secondary-foreground',
        )}
        style={presenter.isAgentSender ? { backgroundColor: presenter.color, color: readableTextColor(presenter.color) } : undefined}
        fallback={presenter.initial}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-sm font-medium"
            style={presenter.isAgentSender ? { color: presenter.color } : undefined}
          >
            {presenter.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {message.role === 'assistant' ? (
          <>
            <StreamingMessage
              blocks={message.blocks}
              isStreaming={message.isStreaming}
            />
            {!message.isStreaming && getPlainContent(message).trim() && (
              <MessageActions content={getPlainContent(message)} />
            )}
          </>
        ) : (
          <div className="space-y-2">
            {message.blocks
              .filter((b): b is Extract<typeof b, { type: 'image' }> => b.type === 'image')
              .map((img, idx) => (
                <img
                  key={`${img.name}-${idx}`}
                  src={img.dataUrl}
                  alt={img.name}
                  className="max-w-sm max-h-80 rounded-lg border border-border object-contain"
                />
              ))}
            {(() => {
              const plain = getPlainContent(message);
              if (!plain) return null;
              const skillContext = parseSkillContextInjection(plain);
              if (skillContext) {
                return <SkillContextChip name={skillContext.name} body={skillContext.body} />;
              }
              return (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {plain}
                </p>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Collapsed marker for a Copilot SDK skill-context injection. The SDK injects
 * a loaded skill (e.g. `lens`) into the conversation as a synthetic user turn;
 * rather than dumping the whole SKILL.md into the transcript, we show a compact
 * chip that expands on demand.
 */
function SkillContextChip({ name, body }: { name: string; body: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <Sparkles size={12} aria-hidden />
        <span>Loaded skill: {name}</span>
      </button>
      {expanded && (
        <pre className="max-h-80 overflow-auto border-t border-border px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {body}
        </pre>
      )}
    </div>
  );
}


