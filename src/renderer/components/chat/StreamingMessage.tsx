import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

interface Props {
  content: string;
  isStreaming?: boolean;
}

export function StreamingMessage({ content, isStreaming }: Props) {
  if (!content && isStreaming) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:300ms]" />
        </div>
        <span className="text-xs">Thinking…</span>
      </div>
    );
  }

  return (
    <div className={cn('prose prose-sm prose-invert max-w-none text-sm leading-relaxed', isStreaming && 'streaming')}>
      <Markdown remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-genesis animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}
