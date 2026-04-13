import React, { useCallback, useEffect, useRef } from 'react';
import { useAppState, useAppDispatch, getPlainContent } from '../../lib/store';
import { ChatInput } from '../chat/ChatInput';
import { StreamingMessage } from '../chat/StreamingMessage';
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
// ChatroomMessageList
// ---------------------------------------------------------------------------

function ChatroomMessageList({ messages, minds }: { messages: ChatroomMessage[]; minds: MindContext[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  useEffect(() => {
    if (isAutoScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((message) => {
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
  const { chatroomMessages, minds, chatroomStreamingByMind, availableModels, selectedModel } = useAppState();
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

      {chatroomMessages.length === 0 ? (
        <ChatroomEmptyState connected={connected} />
      ) : (
        <ChatroomMessageList messages={chatroomMessages} minds={minds} />
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
