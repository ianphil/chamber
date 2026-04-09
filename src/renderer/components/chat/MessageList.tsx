import React, { useEffect, useRef } from 'react';
import { useAppState, getPlainContent } from '../../lib/store';
import { StreamingMessage } from './StreamingMessage';
import { cn, formatTime } from '../../lib/utils';

export function MessageList() {
  const { messages } = useAppState();
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
              {message.role === 'user' ? 'Y' : 'G'}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">
                  {message.role === 'user' ? 'You' : 'Genesis'}
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
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {getPlainContent(message)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
