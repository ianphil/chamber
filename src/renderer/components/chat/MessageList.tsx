import React, { useEffect, useRef } from 'react';
import { useAppState, getPlainContent } from '../../lib/store';
import { StreamingMessage } from './StreamingMessage';
import { cn, formatTime } from '../../lib/utils';

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
        {messages.map((message) => (
          <div key={message.id} className="flex gap-3">
            {/* Avatar */}
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5',
              message.role === 'user'
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-genesis text-primary-foreground'
            )}>
              {message.role === 'user' ? 'Y' : agentName.charAt(0).toUpperCase()}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">
                  {message.role === 'user' ? 'You' : agentName}
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
        ))}
      </div>
    </div>
  );
}
