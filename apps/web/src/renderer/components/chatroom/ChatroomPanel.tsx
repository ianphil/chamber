import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Layers, ListOrdered, MessagesSquare, GitBranch, ClipboardList, RotateCcw, Plus, Users, ArrowDown } from 'lucide-react';
import { useAppState, useAppDispatch, getPlainContent } from '../../lib/store';
import { ChatInput } from '../chat/ChatInput';
import { StreamingMessage } from '../chat/StreamingMessage';
import { MessageActions } from '../chat/MessageActions';
import { OrchestrationPicker } from './OrchestrationPicker';
import { OrchestrationDiagram } from './OrchestrationDiagram';
import { TaskLedgerPanel } from './TaskLedgerPanel';
import { Skeleton } from '../ui/skeleton';
import { cn, formatTime } from '../../lib/utils';
import type { MindContext, UserProfile } from '@chamber/shared/types';
import type { ChatroomMessage } from '@chamber/shared/chatroom-types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { AgentAvatar } from '../profile/AgentAvatar';
import { useMindProfiles } from '../../hooks/useMindProfiles';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import { agentColor } from '../chat/agentColors';

function profileDisplayName(profile: AgentProfileSummary | undefined, fallback: string): string {
  return profile?.displayName?.trim() || fallback;
}

// ---------------------------------------------------------------------------
// Moderator message detection & parsing
// ---------------------------------------------------------------------------

interface ModeratorDecision {
  nextSpeaker: string;
  direction: string;
  action: string;
}

function parseModeratorJson(text: string): ModeratorDecision | null {
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

function isModeratorMessage(message: ChatroomMessage, moderatorMindId?: string): boolean {
  if (message.role !== 'assistant') return false;
  if (moderatorMindId && message.sender?.mindId !== moderatorMindId) return false;
  const text = getPlainContent(message);
  return parseModeratorJson(text) !== null;
}

// ---------------------------------------------------------------------------
// ParticipantBar
// ---------------------------------------------------------------------------

function ParticipantBar({ minds, streamingByMind, disabledMindIds, profileByMindId, onToggle }: {
  minds: MindContext[];
  streamingByMind: Record<string, boolean>;
  disabledMindIds: string[];
  profileByMindId: Record<string, AgentProfileSummary>;
  onToggle: (mindId: string, enabled: boolean) => void;
}) {
  if (minds.length === 0) return null;
  const disabledSet = new Set(disabledMindIds);
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border overflow-x-auto shrink-0">
      {minds.map((mind) => {
        const streaming = streamingByMind[mind.mindId];
        const disabled = disabledSet.has(mind.mindId);
        const profile = profileByMindId[mind.mindId];
        const name = profileDisplayName(profile, mind.identity.name);
        const color = agentColor(minds, mind.mindId, profileByMindId);
        const title = disabled
          ? streaming
            ? `${name} is disabled — currently responding to this round. Click to re-enable.`
            : `${name} is disabled. Click to enable.`
          : `${name} is enabled. Click to disable.`;
        return (
          <button
            type="button"
            key={mind.mindId}
            aria-pressed={!disabled}
            title={title}
            onClick={() => onToggle(mind.mindId, disabled)}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 whitespace-nowrap',
              'transition-opacity cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring',
              disabled
                ? 'opacity-50 line-through hover:opacity-75'
                : 'hover:opacity-90',
            )}
            style={{ backgroundColor: `${color}20`, color }}
          >
            <AgentAvatar
              name={name}
              avatarDataUrl={profile?.avatarDataUrl}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              fallbackClassName="text-white"
              fallback={name.charAt(0).toUpperCase()}
              style={{ backgroundColor: color, color: '#fff' }}
            />
            <span className={cn('w-2 h-2 rounded-full', streaming ? 'bg-warning chamber-caret' : 'bg-genesis')} />
            {name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeratorDecisionBubble — compact system message for moderator routing
// ---------------------------------------------------------------------------

function ModeratorDecisionBubble({ message, minds, profileByMindId }: { message: ChatroomMessage; minds: MindContext[]; profileByMindId: Record<string, AgentProfileSummary> }) {
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

// ---------------------------------------------------------------------------
// TypingIndicator — shows who is currently speaking/thinking
// ---------------------------------------------------------------------------

function TypingIndicator({ speaker, minds, orchestrationMode, profileByMindId }: {
  speaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' };
  minds: MindContext[];
  orchestrationMode?: string;
  profileByMindId: Record<string, AgentProfileSummary>;
}) {
  const color = agentColor(minds, speaker.mindId, profileByMindId);
  const phaseText = speaker.phase === 'moderating'
    ? (orchestrationMode === 'magentic' ? 'is planning…' : 'is deciding who speaks next…')
    : speaker.phase === 'synthesizing'
      ? 'is synthesizing the discussion…'
      : 'is speaking…';

  // Elapsed timer — updates every second
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [speaker.mindId, speaker.phase]);

  const elapsedText = elapsed >= 5
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : '';

  return (
    <div className="flex gap-3">
      {/* Spacer matching avatar width */}
      <div className="w-10 shrink-0" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '300ms' }} />
        </div>
        <span className="text-xs">
          <span className="font-medium" style={{ color }}>{speaker.mindName}</span> {phaseText}
          {elapsedText && <span className="text-foreground/50 ml-1.5">{elapsedText}</span>}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleMessage — completed agent messages render in full; the user may
// manually collapse a long one into a one-line summary.
// ---------------------------------------------------------------------------

function CollapsibleMessage({ message }: { message: ChatroomMessage }) {
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

// ---------------------------------------------------------------------------
// ChatroomMessageRow
// ---------------------------------------------------------------------------

interface ChatroomMessagePresenter {
  senderName: string;
  color: string | undefined;
  isUser: boolean;
  avatarDataUrl: string | null | undefined;
}

// Memoized so an inbound message at the end of a long transcript doesn't force
// every prior message subtree (markdown + rehype-highlight + collapsible cells)
// to re-render. content-visibility hint lets the browser skip layout/paint
// work for off-screen rows.
const ChatroomMessageRow = memo(function ChatroomMessageRow({
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

// ---------------------------------------------------------------------------
// ChatroomMessageList
// ---------------------------------------------------------------------------

function ChatroomMessageList({
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

// ---------------------------------------------------------------------------
// MetricsSummaryCard — shows orchestration stats after completion
// ---------------------------------------------------------------------------

function MetricsSummaryCard({ metrics }: {
  metrics: { elapsedMs: number; totalTasks: number; completedTasks: number; failedTasks: number; agentsUsed: number; orchestrationMode: string };
}) {
  const mins = Math.floor(metrics.elapsedMs / 60000);
  const secs = Math.floor((metrics.elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-2">
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-secondary/60 border border-border text-xs">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/60"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="text-foreground/70">{timeStr}</span>
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/60"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="text-foreground/70">{metrics.agentsUsed} agent{metrics.agentsUsed !== 1 ? 's' : ''}</span>
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <div className="flex items-center gap-1.5">
          {metrics.failedTasks === 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          )}
          <span className="text-foreground/70">{metrics.completedTasks}/{metrics.totalTasks} tasks</span>
          {metrics.failedTasks > 0 && <span className="text-amber-500">({metrics.failedTasks} failed)</span>}
        </div>
        <div className="w-px h-3 bg-muted-foreground/20" />
        <span className="text-foreground/50 uppercase tracking-wide">{metrics.orchestrationMode}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode-driven starter scenarios
//
// One per orchestration mode so the empty state demonstrates what each
// collaboration shape *is*, rather than pitching a particular industry.
// Domain-specific demos (manufacturing, fintech, customer-escalation, etc.)
// were swapped out because they hid the underlying primitives.
// ---------------------------------------------------------------------------

interface DemoScenario {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  modeLabel: string;
  mode: 'concurrent' | 'sequential' | 'group-chat' | 'handoff' | 'magentic';
  prompt: string;
  summary: string;
}

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    icon: Layers,
    label: 'Brainstorm three angles',
    modeLabel: 'Concurrent',
    mode: 'concurrent',
    summary: 'All agents weigh in on the same question, independently.',
    prompt: 'I want three independent takes on the same question. Each of you, give your best answer to: "What is the most important risk in this plan, and how would you mitigate it?" Do not coordinate with each other.',
  },
  {
    icon: ListOrdered,
    label: 'Outline, draft, polish',
    modeLabel: 'Sequential',
    mode: 'sequential',
    summary: 'Each agent improves the previous agent\'s output.',
    prompt: 'Work as a writing pipeline. The first agent outlines a short briefing on the topic I share next, the second drafts it from the outline, the third polishes tone and tightens it. Topic: introducing a new internal process to a busy team.',
  },
  {
    icon: MessagesSquare,
    label: 'Roundtable discussion',
    modeLabel: 'Group Chat',
    mode: 'group-chat',
    summary: 'Agents take turns; the moderator decides who speaks next.',
    prompt: 'Hold a roundtable on this question: "Should we prioritize shipping a smaller feature this week, or invest the week in reducing tech debt?" Each agent should make their case once, respond to one other agent, then propose a recommendation.',
  },
  {
    icon: GitBranch,
    label: 'Triage and route',
    modeLabel: 'Handoff',
    mode: 'handoff',
    summary: 'First agent diagnoses, hands off to the right specialist.',
    prompt: 'Triage this problem and hand off to the agent best suited to solve it. Problem: a teammate is blocked on a task they took on two days ago and has gone quiet. Diagnose the most likely cause, then hand off to whoever should follow up.',
  },
  {
    icon: ClipboardList,
    label: 'Plan, delegate, verify',
    modeLabel: 'Manager-led',
    mode: 'magentic',
    summary: 'One agent breaks the work down and coordinates the others.',
    prompt: 'Treat this as a small project. Break the goal into 3-5 sub-tasks, delegate each to the most suitable agent, then verify the results and produce a final summary. Goal: prepare a one-page brief I can share with my manager about how my team is using AI tools today.',
  },
];

// ---------------------------------------------------------------------------
// ChatroomHydratingSkeleton
// ---------------------------------------------------------------------------

/**
 * Placeholder shown while the chatroom auto-resumes its active session on
 * mount. Mirrors the single-agent chat's hydrating skeleton: avatar + name +
 * message lines in the real transcript's shape, so a resumed conversation
 * settles in place instead of popping in over the session picker.
 */
function ChatroomHydratingSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" aria-busy="true" data-testid="chatroom-hydrating-skeleton">
      <div className="max-w-3xl mx-auto space-y-6">
        {[2, 1, 3].map((lines, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-10 h-10 rounded-full shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-12" />
              </div>
              {Array.from({ length: lines }).map((_, line) => (
                <Skeleton key={line} className={cn('h-3', line === lines - 1 ? 'w-[60%]' : 'w-full')} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatroomEmptyState
// ---------------------------------------------------------------------------

function ChatroomEmptyState({ connected, onPickPrompt }: { connected: boolean; onPickPrompt?: (prompt: string, mode: DemoScenario['mode']) => void }) {
  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground text-center">
          No agents loaded. Add an agent to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4 gap-6">
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground mb-1">Work with several agents at once</h3>
        <p className="text-xs text-muted-foreground">Pick how they should collaborate, then ask the room -- or start from a pattern below.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
        {DEMO_SCENARIOS.map((scenario) => {
          const Icon = scenario.icon;
          return (
            <button
              key={scenario.label}
              onClick={() => onPickPrompt?.(scenario.prompt, scenario.mode)}
              title={scenario.summary}
              className="text-left px-3 py-2.5 rounded-lg border border-border bg-secondary/40 transition-[background-color,border-color,box-shadow] duration-150 group hover:bg-secondary/90 hover:border-foreground/20 hover:shadow-sm dark:hover:bg-secondary/70 dark:hover:border-border dark:hover:shadow-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className="shrink-0 text-foreground/70 group-hover:text-foreground" />
                <span className="text-sm font-medium text-foreground group-hover:text-foreground">{scenario.label}</span>
                <span className="text-[10px] text-foreground/50 ml-auto uppercase tracking-wide">{scenario.modeLabel}</span>
              </div>
              <p className="text-xs text-foreground/70 line-clamp-2">{scenario.summary}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatroomPanel
// ---------------------------------------------------------------------------

export function ChatroomPanel() {
  const {
    chatroomMessages,
    minds,
    chatroomStreamingByMind,
    availableModels,
    selectedModel,
    chatroomOrchestration,
    chatroomGroupChatConfig,
    chatroomHandoffConfig,
    chatroomMagenticConfig,
    chatroomActiveSpeaker,
    chatroomTaskLedger,
    chatroomMetrics,
    chatroomDisabledMindIds,
    chatroomSessions,
    activeChatroomSessionId,
  } = useAppState();
  const dispatch = useAppDispatch();
  const profileByMindId = useMindProfiles(minds);
  const userProfile = useUserProfile();
  const isStreaming = Object.values(chatroomStreamingByMind).some(Boolean);
  const hasActiveSession = activeChatroomSessionId !== null;
  const activeSession = chatroomSessions.find((s) => s.sessionId === activeChatroomSessionId);
  const connected = minds.length > 0;

  // Composer draft (controlled). Lets scenario clicks stage a prompt for the
  // user to review and edit before sending, instead of auto-firing.
  const [draft, setDraft] = useState('');
  // True while the on-mount auto-resume is still in flight. Shows a skeleton
  // (instead of flashing the picker) so a resumed transcript doesn't pop in.
  // Mirrors the single-agent chat hydrating state.
  const [isResuming, setIsResuming] = useState(true);
  // Grace-gate the resuming skeleton so a fast auto-resume doesn't flash a pulse.
  const showResumingSkeleton = useDelayedFlag(isResuming);
  // Hold the entire panel (chrome + content + composer) behind a single
  // skeleton while we auto-resume a backend-active session that the renderer
  // doesn't know about yet. Without this the composer and orchestration chrome
  // render first and the resumed transcript pops in above them. Once a session
  // is active (or the resume settles to the picker) we render everything at
  // once so nothing lands piecemeal. Active sessions already in renderer state
  // (the common case, and every unit test) skip the skeleton entirely.
  const showResumeSkeleton = !hasActiveSession && isResuming;

  /**
   * Create a fresh chatroom session and resume it in one shot. Used by the
   * picker's "+ New chatroom" CTA and by starter cards, where the user has
   * actively committed to starting a new conversation. The session-header
   * and sidebar "+ New chatroom" affordances use `handleResetToPicker`
   * instead so we don't pile up empty drafts every time the user wants to
   * start over.
   */
  const handleCreateAndResume = useCallback(async (): Promise<string | null> => {
    try {
      const created = await window.electronAPI.chatroom.createSession();
      const resumed = await window.electronAPI.chatroom.resumeSession(created.sessionId);
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'RESUME_CHATROOM_SESSION', payload: { ...resumed, sessions } });
      return created.sessionId;
    } catch {
      return null;
    }
  }, [dispatch]);

  /**
   * Reset back to the picker without creating a new session on disk. The
   * actual new session is created lazily on first Send (see handleSend).
   * This avoids the empty-session-spam problem where every header click
   * left an unused "New chatroom" entry in the sidebar.
   */
  const handleResetToPicker = useCallback(async () => {
    dispatch({ type: 'CLEAR_ACTIVE_CHATROOM_SESSION' });
    // Keep the sidebar list fresh in case the backend has changes.
    try {
      const sessions = await window.electronAPI.chatroom.listSessions();
      dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
    } catch {
      // Non-fatal.
    }
  }, [dispatch]);

  const handlePickPrompt = useCallback((prompt: string, mode: DemoScenario['mode']) => {
    // Stage the prompt into the composer; no session is created until the
    // user actually hits Send (handleSend does the lazy create). Also target
    // the scenario's orchestration mode so the room is pre-configured to run
    // the pattern the card demonstrates.
    setDraft(prompt);
    if (mode !== chatroomOrchestration) {
      dispatch({ type: 'SET_ORCHESTRATION', payload: mode });
      const config = mode === 'group-chat' ? chatroomGroupChatConfig
        : mode === 'handoff' ? chatroomHandoffConfig
        : mode === 'magentic' ? chatroomMagenticConfig
        : undefined;
      window.electronAPI.chatroom.setOrchestration(mode, config ?? undefined);
    }
  }, [dispatch, chatroomOrchestration, chatroomGroupChatConfig, chatroomHandoffConfig, chatroomMagenticConfig]);

  const handleClearChatroom = useCallback(async () => {
    if (isStreaming) return;
    await window.electronAPI.chatroom.clear();
    dispatch({ type: 'CHATROOM_CLEAR' });
  }, [dispatch, isStreaming]);

  // Load sessions and auto-resume the backend-active one on mount.
  //
  // ChatroomService restores its active pointer from disk at startup (and
  // legacy migration sets it for upgraders). On the renderer side we need
  // to match that so the panel doesn't open to the picker when the user
  // already has a session in progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessions = await window.electronAPI.chatroom.listSessions();
        if (cancelled) return;
        dispatch({ type: 'SET_CHATROOM_SESSIONS', payload: sessions });
        const backendActive = sessions.find((s) => s.active);
        if (backendActive && backendActive.sessionId !== activeChatroomSessionId) {
          const resumed = await window.electronAPI.chatroom.resumeSession(backendActive.sessionId);
          if (cancelled) return;
          dispatch({ type: 'RESUME_CHATROOM_SESSION', payload: { ...resumed, sessions } });
        }
      } catch {
        // Non-fatal: leave the panel in its picker state.
      } finally {
        if (!cancelled) setIsResuming(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally only run on mount; sidebar handles further refreshes.
  }, [dispatch]);

  // Subscribe to chatroom events
  useEffect(() => {
    const unsub = window.electronAPI.chatroom.onEvent((event) => {
      dispatch({ type: 'CHATROOM_EVENT', payload: event });
    });
    return unsub;
  }, [dispatch]);

  // Hydrate disabled-mind set on mount and stay in sync via the
  // authoritative state-changed channel (other windows can also toggle).
  // Subscribe FIRST, snapshot SECOND, and ignore the snapshot if the
  // authoritative channel has already published — otherwise a slow snapshot
  // can stomp a fresher state-changed event from another window.
  useEffect(() => {
    let cancelled = false;
    let receivedAuthoritativeUpdate = false;
    const unsub = window.electronAPI.chatroom.onStateChanged((state) => {
      if (cancelled) return;
      receivedAuthoritativeUpdate = true;
      dispatch({ type: 'SET_CHATROOM_DISABLED_MIND_IDS', payload: state.disabledMindIds });
    });
    window.electronAPI.chatroom.getDisabledMindIds().then((ids) => {
      if (cancelled || receivedAuthoritativeUpdate) return;
      dispatch({ type: 'SET_CHATROOM_DISABLED_MIND_IDS', payload: ids });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [dispatch]);

  const handleToggleMind = useCallback((mindId: string, enabled: boolean) => {
    // Authoritative model: the click only invokes IPC; the state-changed
    // event from the service drives the visible state.
    void window.electronAPI.chatroom.setMindEnabled(mindId, enabled);
  }, []);

  const handleSend = useCallback(async (content: string) => {
    // Lazy session creation: if the user is in the picker (no active
    // session) and types straight into the composer, create + resume the
    // session right before sending so the picker doesn't leave behind a
    // pile of empty drafts.
    if (!activeChatroomSessionId) {
      const created = await handleCreateAndResume();
      if (!created) return;
    }
    const roundId = crypto.randomUUID();
    dispatch({
      type: 'CHATROOM_USER_MESSAGE',
      payload: {
        id: `user-${roundId}`,
        role: 'user',
        blocks: [{ type: 'text', content }],
        timestamp: Date.now(),
        sender: { mindId: 'user', name: 'You' },
        roundId,
      },
    });
    setDraft('');
    await window.electronAPI.chatroom.send(content, selectedModel ?? undefined, roundId);
  }, [activeChatroomSessionId, dispatch, handleCreateAndResume, selectedModel]);

  const handleStop = useCallback(async () => {
    await window.electronAPI.chatroom.stop();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {showResumeSkeleton ? (
        showResumingSkeleton ? <ChatroomHydratingSkeleton /> : null
      ) : (
        <>
      {hasActiveSession && activeSession ? (
        <div className="border-b border-border bg-card/40 px-4 py-2.5 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-semibold text-foreground" title={activeSession.title}>
              {activeSession.title}
            </span>
            <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Chatroom
            </span>
            {minds.length < 2 ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                Single agent - add more for multi-agent modes
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { void handleResetToPicker(); }}
            title="Start a new chatroom (created on first message)"
            aria-label="New chatroom"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={12} aria-hidden />
            New chatroom
          </button>
        </div>
      ) : null}

      {minds.length > 0 ? (
        <>
          <ParticipantBar
            minds={minds}
            streamingByMind={chatroomStreamingByMind}
            disabledMindIds={chatroomDisabledMindIds}
            profileByMindId={profileByMindId}
            onToggle={handleToggleMind}
          />

          <OrchestrationPicker
            mode={chatroomOrchestration}
            groupChatConfig={chatroomGroupChatConfig}
            handoffConfig={chatroomHandoffConfig}
            magneticConfig={chatroomMagenticConfig}
            minds={minds}
            disabled={isStreaming}
            onModeChange={(mode) => {
              dispatch({ type: 'SET_ORCHESTRATION', payload: mode });
              const config = mode === 'group-chat' ? chatroomGroupChatConfig
                : mode === 'handoff' ? chatroomHandoffConfig
                : mode === 'magentic' ? chatroomMagenticConfig
                : undefined;
              window.electronAPI.chatroom.setOrchestration(mode, config ?? undefined);
            }}
            onGroupChatConfigChange={(config) => {
              dispatch({ type: 'SET_GROUP_CHAT_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('group-chat', config);
            }}
            onHandoffConfigChange={(config) => {
              dispatch({ type: 'SET_HANDOFF_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('handoff', config);
            }}
            onMagneticConfigChange={(config) => {
              dispatch({ type: 'SET_MAGENTIC_CONFIG', payload: config });
              window.electronAPI.chatroom.setOrchestration('magentic', config);
            }}
          />

          <OrchestrationDiagram
            mode={chatroomOrchestration}
            minds={minds}
            profileByMindId={profileByMindId}
            streamingByMind={chatroomStreamingByMind}
            activeSpeaker={chatroomActiveSpeaker}
            disabledMindIds={chatroomDisabledMindIds}
            groupChatConfig={chatroomGroupChatConfig}
            handoffConfig={chatroomHandoffConfig}
            magneticConfig={chatroomMagenticConfig}
            taskLedger={chatroomTaskLedger}
          />
        </>
      ) : null}

      {hasActiveSession ? (
        <>
          {chatroomTaskLedger.length > 0 && chatroomOrchestration === 'magentic' && (
            <TaskLedgerPanel
              ledger={chatroomTaskLedger}
              minds={minds}
              onRetry={(taskId) => {
                const task = chatroomTaskLedger.find((t) => t.id === taskId);
                if (task) {
                  handleSend(`Please retry the failed task: ${task.description}`);
                }
              }}
            />
          )}

          {chatroomMessages.length === 0 ? (
            <ChatroomEmptyState connected={connected} onPickPrompt={handlePickPrompt} />
          ) : (
            <>
              <ChatroomMessageList
                messages={chatroomMessages}
                minds={minds}
                profileByMindId={profileByMindId}
                userProfile={userProfile}
                moderatorMindId={chatroomOrchestration === 'group-chat' ? chatroomGroupChatConfig?.moderatorMindId : undefined}
                activeSpeaker={chatroomActiveSpeaker}
                orchestrationMode={chatroomOrchestration}
              />
              <div className="border-t border-border px-4 py-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { void handleClearChatroom(); }}
                  disabled={isStreaming}
                  title={isStreaming ? 'Stop streaming first' : 'Clear this chatroom and show the starter prompts again'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={12} aria-hidden />
                  Show starter prompts
                </button>
              </div>
            </>
          )}

          {chatroomMetrics && !isStreaming && chatroomOrchestration === 'magentic' && (
            <MetricsSummaryCard metrics={chatroomMetrics} />
          )}
        </>
      ) : (
        <ChatroomSessionPicker
          hasSessions={chatroomSessions.length > 0}
          mindCount={minds.length}
          onPickPrompt={handlePickPrompt}
          onGoToChat={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' })}
        />
      )}

      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={!connected || minds.length === 0}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={(model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model })}
        placeholder={hasActiveSession ? 'Message the chatroom…' : 'Type a message to start a new chatroom…'}
        value={draft}
        onValueChange={setDraft}
      />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatroomSessionPicker — empty state when no chatroom session is active
// ---------------------------------------------------------------------------

interface ChatroomSessionPickerProps {
  hasSessions: boolean;
  mindCount: number;
  onPickPrompt: (prompt: string, mode: DemoScenario['mode']) => void;
  onGoToChat: () => void;
}

function ChatroomSessionPicker({ hasSessions, mindCount, onPickPrompt, onGoToChat }: ChatroomSessionPickerProps) {
  const noAgents = mindCount === 0;
  const singleAgent = mindCount === 1;

  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4 gap-5 overflow-y-auto py-6">
      <div className="max-w-md space-y-2 text-center">
        <h2 className="text-base font-semibold text-foreground">
          {noAgents
            ? 'Add an agent to start a chatroom'
            : hasSessions
              ? 'Pick a chatroom on the right, or start a new one'
              : 'Start your first chatroom'}
        </h2>
        <p className="text-xs text-muted-foreground">
          {noAgents
            ? 'Chatrooms run a prompt across multiple agents at once. Add an agent first, then come back here.'
            : 'Pick a pattern below or type a message in the composer to start fresh. The chatroom is created on your first send, so you can change your mind before committing.'}
        </p>
      </div>

      {singleAgent ? (
        <div className="max-w-md rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100">
          <p className="font-medium text-amber-50">You only have one agent loaded.</p>
          <p className="mt-1 opacity-90">
            Chatrooms shine with two or more agents (debate, handoff, manager-led
            workflows). With just one agent, this behaves the same as a regular
            chat - which Chat already does better.
          </p>
          <button
            type="button"
            onClick={onGoToChat}
            className="mt-2 rounded-md border border-amber-500/40 px-2.5 py-1 text-xs text-amber-50 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open Chat instead
          </button>
        </div>
      ) : null}

      {!noAgents ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
          {DEMO_SCENARIOS.map((scenario) => {
            const Icon = scenario.icon;
            return (
              <button
                key={scenario.label}
                onClick={() => onPickPrompt(scenario.prompt, scenario.mode)}
                title={scenario.summary}
                className="text-left px-3 py-2.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary/70 hover:border-border transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className="shrink-0 text-foreground/70 group-hover:text-foreground" />
                  <span className="text-sm font-medium text-foreground group-hover:text-foreground">{scenario.label}</span>
                  <span className="text-[10px] text-foreground/50 ml-auto uppercase tracking-wide">{scenario.modeLabel}</span>
                </div>
                <p className="text-xs text-foreground/70 line-clamp-2">{scenario.summary}</p>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
