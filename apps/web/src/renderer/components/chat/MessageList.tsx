import React, { useEffect, useRef } from 'react';
import { useAppState, getPlainContent } from '../../lib/store';
import { StreamingMessage } from './StreamingMessage';
import { cn, formatTime } from '../../lib/utils';
import type { ChatMessage, MindContext } from '../../../shared/types';

const AGENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function agentColor(minds: MindContext[], mindId: string): string {
  const idx = minds.findIndex(m => m.mindId === mindId);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
}

function displayName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function messagePresenter(message: ChatMessage, agentName: string, minds: MindContext[]) {
  if (message.role === 'assistant') {
    const name = displayName(agentName, 'Agent');
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: undefined,
      isAgentSender: false,
    };
  }

  if (message.sender && message.sender.mindId !== 'user') {
    const name = displayName(message.sender.name, 'Unknown Agent');
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      color: agentColor(minds, message.sender.mindId),
      isAgentSender: true,
    };
  }

  return {
    name: 'You',
    initial: 'Y',
    color: undefined,
    isAgentSender: false,
  };
}

export function MessageList() {
  const { messagesByMind, activeMindId, minds } = useAppState();
  const messages = activeMindId ? (messagesByMind[activeMindId] ?? []) : [];
  const activeMind = minds.find(m => m.mindId === activeMindId);
  const agentName = activeMind?.identity.name ?? 'Agent';
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
    // Auto-scroll if within 100px of bottom
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((message) => {
          const presenter = messagePresenter(message, agentName, minds);

          return (
            <div key={message.id} className="flex gap-3">
              {/* Avatar */}
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5',
                  message.role === 'assistant'
                    ? 'bg-genesis text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground',
                )}
                style={presenter.isAgentSender ? { backgroundColor: presenter.color, color: '#fff' } : undefined}
              >
                {presenter.initial}
              </div>

              {/* Content */}
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
                  <StreamingMessage
                    blocks={message.blocks}
                    isStreaming={message.isStreaming}
                  />
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
                    {getPlainContent(message) && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {getPlainContent(message)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
