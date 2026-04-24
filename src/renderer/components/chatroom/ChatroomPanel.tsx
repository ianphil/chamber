import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState, useAppDispatch, getPlainContent } from '../../lib/store';
import { ChatInput } from '../chat/ChatInput';
import { StreamingMessage } from '../chat/StreamingMessage';
import { OrchestrationPicker } from './OrchestrationPicker';
import { TaskLedgerPanel } from './TaskLedgerPanel';
import { cn, formatTime } from '../../lib/utils';
import type { MindContext } from '../../../shared/types';
import type { ChatroomMessage } from '../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// Colour palette for agent badges
// ---------------------------------------------------------------------------

const AGENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function agentColor(minds: MindContext[], mindId: string): string {
  const idx = minds.findIndex(m => m.mindId === mindId);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
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

function ParticipantBar({ minds, streamingByMind }: { minds: MindContext[]; streamingByMind: Record<string, boolean> }) {
  if (minds.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border overflow-x-auto shrink-0">
      {minds.map((mind, i) => {
        const streaming = streamingByMind[mind.mindId];
        return (
          <span
            key={mind.mindId}
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 whitespace-nowrap"
            style={{ backgroundColor: `${AGENT_COLORS[i % AGENT_COLORS.length]}20`, color: AGENT_COLORS[i % AGENT_COLORS.length] }}
          >
            <span className={cn('w-2 h-2 rounded-full', streaming ? 'bg-yellow-400 animate-pulse' : 'bg-green-500')} />
            {mind.identity.name}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeratorDecisionBubble — compact system message for moderator routing
// ---------------------------------------------------------------------------

function ModeratorDecisionBubble({ message, minds }: { message: ChatroomMessage; minds: MindContext[] }) {
  const text = getPlainContent(message);
  const decision = parseModeratorJson(text);
  if (!decision) return null;

  const color = agentColor(minds, message.sender?.mindId ?? '');
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

function TypingIndicator({ speaker, minds, orchestrationMode }: {
  speaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' };
  minds: MindContext[];
  orchestrationMode?: string;
}) {
  const color = agentColor(minds, speaker.mindId);
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
      <div className="w-7 shrink-0" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '300ms' }} />
        </div>
        <span className="text-xs">
          <span className="font-medium" style={{ color }}>{speaker.mindName}</span> {phaseText}
          {elapsedText && <span className="text-zinc-600 ml-1.5">{elapsedText}</span>}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleMessage — auto-collapses long completed agent messages
// ---------------------------------------------------------------------------

function CollapsibleMessage({ message }: { message: ChatroomMessage }) {
  const plainText = getPlainContent(message);
  const isLong = plainText.length > 300;
  const isComplete = !message.isStreaming;
  const [collapsed, setCollapsed] = useState(isLong && isComplete);

  // Auto-collapse when streaming finishes on long messages
  const prevStreaming = useRef(message.isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !message.isStreaming && plainText.length > 300) {
      setCollapsed(true);
    }
    prevStreaming.current = message.isStreaming;
  }, [message.isStreaming, plainText.length]);

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
      className="border border-zinc-800 rounded-md px-3 py-2 bg-zinc-900/30 cursor-pointer hover:bg-zinc-900/50 transition-colors"
      onClick={() => setCollapsed(false)}
    >
      <div className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0"><polyline points="6 9 12 15 18 9"/></svg>
        <span className="text-sm text-zinc-300 truncate">{summary || 'View response'}</span>
        {toolCount > 0 && (
          <span className="text-xs text-zinc-500 shrink-0">({toolCount} tool call{toolCount > 1 ? 's' : ''})</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatroomMessageList
// ---------------------------------------------------------------------------

function ChatroomMessageList({
  messages,
  minds,
  moderatorMindId,
  activeSpeaker,
  orchestrationMode,
}: {
  messages: ChatroomMessage[];
  minds: MindContext[];
  moderatorMindId?: string;
  activeSpeaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null;
  orchestrationMode?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  useEffect(() => {
    if (isAutoScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeSpeaker]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((message) => {
          // Moderator routing messages → compact system bubble
          if (moderatorMindId && isModeratorMessage(message, moderatorMindId)) {
            return <ModeratorDecisionBubble key={message.id} message={message} minds={minds} />;
          }

          const isUser = message.role === 'user';
          const senderName = message.sender?.name ?? 'Unknown';
          const color = isUser ? undefined : agentColor(minds, message.sender?.mindId ?? '');

          return (
            <div key={message.id} className="flex gap-3">
              {/* Avatar */}
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5',
                  isUser && 'bg-secondary text-secondary-foreground',
                )}
                style={isUser ? undefined : { backgroundColor: color, color: '#fff' }}
              >
                {isUser ? 'Y' : senderName.charAt(0).toUpperCase()}
              </div>

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
                  <CollapsibleMessage message={message} />
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {getPlainContent(message)}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {activeSpeaker && (
          <TypingIndicator speaker={activeSpeaker} minds={minds} orchestrationMode={orchestrationMode} />
        )}
      </div>
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
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="text-zinc-400">{timeStr}</span>
        </div>
        <div className="w-px h-3 bg-zinc-700" />
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="text-zinc-400">{metrics.agentsUsed} agent{metrics.agentsUsed !== 1 ? 's' : ''}</span>
        </div>
        <div className="w-px h-3 bg-zinc-700" />
        <div className="flex items-center gap-1.5">
          {metrics.failedTasks === 0 ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          )}
          <span className="text-zinc-400">{metrics.completedTasks}/{metrics.totalTasks} tasks</span>
          {metrics.failedTasks > 0 && <span className="text-amber-500">({metrics.failedTasks} failed)</span>}
        </div>
        <div className="w-px h-3 bg-zinc-700" />
        <span className="text-zinc-600 uppercase tracking-wide">{metrics.orchestrationMode}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo scenario prompts
// ---------------------------------------------------------------------------

const DEMO_SCENARIOS = [
  {
    icon: '🏭',
    label: 'Manufacturing Business Case',
    mode: 'magentic' as const,
    prompt: 'Build a business case for our manufacturing leadership team. Have one agent research how predictive maintenance with Azure IoT Hub reduces unplanned downtime, another analyze the cost of deploying computer vision quality inspection on the production line, and then combine both into an executive summary with ROI projections and a recommended 90-day pilot plan.',
  },
  {
    icon: '⚖️',
    label: 'Architecture Debate',
    mode: 'group-chat' as const,
    prompt: 'Debate the trade-offs between microservices and monolithic architecture for a high-growth fintech startup processing 10,000 transactions per second. Consider team size (15 engineers), time to market, operational complexity, and scaling needs. Reach a consensus recommendation.',
  },
  {
    icon: '🔗',
    label: 'Customer Escalation',
    mode: 'handoff' as const,
    prompt: 'A customer reports that their Azure Function App cold starts have increased from 2s to 15s after upgrading to .NET 8. Diagnose the issue, check for known issues, propose a fix, and draft a customer response.',
  },
  {
    icon: '📊',
    label: 'Competitive Analysis',
    mode: 'magentic' as const,
    prompt: 'Create a competitive analysis of GitHub Copilot vs Cursor vs Windsurf for enterprise developer productivity. Have each agent research a different product, then synthesize findings into a comparison matrix with recommendations for our engineering leadership.',
  },
  {
    icon: '🛡️',
    label: 'Security Review',
    mode: 'magentic' as const,
    prompt: 'Conduct a security assessment of a Node.js Express API that handles user authentication. One agent should review OWASP Top 10 risks, another should analyze authentication best practices (JWT, session management, rate limiting), and a third should combine findings into a prioritized remediation plan.',
  },
];

// ---------------------------------------------------------------------------
// ChatroomEmptyState
// ---------------------------------------------------------------------------

function ChatroomEmptyState({ connected, onSend }: { connected: boolean; onSend?: (prompt: string) => void }) {
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
    <div className="flex-1 flex flex-col items-center justify-center px-4 gap-6">
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground mb-1">Multi-Agent Chatroom</h3>
        <p className="text-xs text-muted-foreground">Choose a scenario or type your own message below</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
        {DEMO_SCENARIOS.map((scenario) => (
          <button
            key={scenario.label}
            onClick={() => onSend?.(scenario.prompt)}
            className="text-left px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/70 hover:border-zinc-700 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{scenario.icon}</span>
              <span className="text-sm font-medium text-zinc-200 group-hover:text-foreground">{scenario.label}</span>
              <span className="text-[10px] text-zinc-600 ml-auto uppercase">{scenario.mode}</span>
            </div>
            <p className="text-xs text-zinc-500 line-clamp-2">{scenario.prompt.slice(0, 120)}…</p>
          </button>
        ))}
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
  } = useAppState();
  const dispatch = useAppDispatch();
  const isStreaming = Object.values(chatroomStreamingByMind).some(Boolean);
  const connected = minds.length > 0;

  // Load history and task ledger on mount
  useEffect(() => {
    window.electronAPI.chatroom.history().then((messages) => {
      dispatch({ type: 'SET_CHATROOM_HISTORY', payload: messages });
    });
    window.electronAPI.chatroom.taskLedger().then((ledger) => {
      if (ledger.length > 0) {
        dispatch({ type: 'SET_CHATROOM_TASK_LEDGER', payload: ledger });
      }
    });
  }, [dispatch]);

  // Subscribe to chatroom events
  useEffect(() => {
    const unsub = window.electronAPI.chatroom.onEvent((event) => {
      dispatch({ type: 'CHATROOM_EVENT', payload: event });
    });
    return unsub;
  }, [dispatch]);

  const handleSend = useCallback(async (content: string) => {
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
    await window.electronAPI.chatroom.send(content, selectedModel ?? undefined);
  }, [dispatch, selectedModel]);

  const handleStop = useCallback(async () => {
    await window.electronAPI.chatroom.stop();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ParticipantBar minds={minds} streamingByMind={chatroomStreamingByMind} />

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
        <ChatroomEmptyState connected={connected} onSend={handleSend} />
      ) : (
        <ChatroomMessageList
          messages={chatroomMessages}
          minds={minds}
          moderatorMindId={chatroomOrchestration === 'group-chat' ? chatroomGroupChatConfig?.moderatorMindId : undefined}
          activeSpeaker={chatroomActiveSpeaker}
          orchestrationMode={chatroomOrchestration}
        />
      )}

      {chatroomMetrics && !isStreaming && chatroomOrchestration === 'magentic' && (
        <MetricsSummaryCard metrics={chatroomMetrics} />
      )}

      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={!connected}
        availableModels={availableModels}
        selectedModel={selectedModel}
        onModelChange={(model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model })}
        placeholder="Message the chatroom…"
      />
    </div>
  );
}
