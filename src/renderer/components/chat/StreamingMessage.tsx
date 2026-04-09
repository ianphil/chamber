import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';
import { ToolBlock } from './ToolBlock';
import { ReasoningBlock } from './ReasoningBlock';
import type { ContentBlock } from '../../../shared/types';

interface Props {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}

export function StreamingMessage({ blocks, isStreaming }: Props) {
  if (blocks.length === 0 && isStreaming) {
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

  // Check if the last block is a running tool (show thinking after it)
  const lastBlock = blocks[blocks.length - 1];
  const showTrailingIndicator = isStreaming && (!lastBlock || lastBlock.type !== 'text');

  return (
    <div className="space-y-0">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <div
                key={`text-${i}`}
                className={cn(
                  'prose prose-sm prose-invert max-w-none text-sm leading-relaxed',
                  isStreaming && i === blocks.length - 1 && 'streaming'
                )}
              >
                <Markdown remarkPlugins={[remarkGfm]}>
                  {block.content}
                </Markdown>
                {isStreaming && i === blocks.length - 1 && (
                  <span className="inline-block w-0.5 h-4 bg-genesis animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            );

          case 'tool_call':
            return <ToolBlock key={block.toolCallId} block={block} />;

          case 'reasoning':
            return (
              <ReasoningBlock
                key={block.reasoningId}
                block={block}
                isStreaming={isStreaming && i === blocks.length - 1}
              />
            );
        }
      })}
      {showTrailingIndicator && (
        <div className="flex items-center gap-1.5 text-muted-foreground mt-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-genesis animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
