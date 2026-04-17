import React, { useCallback, useEffect, useRef } from 'react';
import { useAppState, useAppDispatch, getPlainContent } from '../../lib/store';
import { ChatInput } from '../chat/ChatInput';
import { StreamingMessage } from '../chat/StreamingMessage';
import { OrchestrationPicker } from './OrchestrationPicker';
import { cn, formatTime } from '../../lib/utils';
import type { MindContext } from '../../../shared/types';
import type { ChatroomMessage, OrchestrationEvent } from '../../../shared/chatroom-types';

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

function TypingIndicator({ speaker, minds }: {
  speaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' };
  minds: MindContext[];
}) {
  const color = agentColor(minds, speaker.mindId);
  const phaseText = speaker.phase === 'moderating'
    ? 'is deciding who speaks next…'
    : speaker.phase === 'synthesizing'
      ? 'is synthesizing the discussion…'
      : 'is speaking…';

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '300ms' }} />
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium" style={{ color }}>{speaker.mindName}</span> {phaseText}
        </span>
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
}: {
  messages: ChatroomMessage[];
  minds: MindContext[];
  moderatorMindId?: string;
  activeSpeaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' } | null;
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
                  <StreamingMessage blocks={message.blocks} isStreaming={message.isStreaming} />
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
          <TypingIndicator speaker={activeSpeaker} minds={minds} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatroomEmptyState
// ---------------------------------------------------------------------------

function ChatroomEmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <p className="text-sm text-muted-foreground text-center">
        {connected
          ? 'This is the chatroom. Messages you send here go to all agents.'
          : 'No agents loaded. Add an agent to start chatting.'}
      </p>
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
    chatroomActiveSpeaker,
  } = useAppState();
  const dispatch = useAppDispatch();
  const isStreaming = Object.values(chatroomStreamingByMind).some(Boolean);
  const connected = minds.length > 0;

  // Load history on mount
  useEffect(() => {
    window.electronAPI.chatroom.history().then((messages) => {
      dispatch({ type: 'SET_CHATROOM_HISTORY', payload: messages });
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
        minds={minds}
        disabled={isStreaming}
        onModeChange={(mode) => {
          dispatch({ type: 'SET_ORCHESTRATION', payload: mode });
          window.electronAPI.chatroom.setOrchestration(mode, chatroomGroupChatConfig ?? undefined);
        }}
        onGroupChatConfigChange={(config) => {
          dispatch({ type: 'SET_GROUP_CHAT_CONFIG', payload: config });
          window.electronAPI.chatroom.setOrchestration(chatroomOrchestration, config);
        }}
      />

      {chatroomMessages.length === 0 ? (
        <ChatroomEmptyState connected={connected} />
      ) : (
        <ChatroomMessageList
          messages={chatroomMessages}
          minds={minds}
          moderatorMindId={chatroomOrchestration === 'group-chat' ? chatroomGroupChatConfig?.moderatorMindId : undefined}
          activeSpeaker={chatroomActiveSpeaker}
        />
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
