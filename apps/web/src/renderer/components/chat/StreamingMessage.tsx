import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '../../lib/utils';
import { WorkGroup, hasRunningTool } from './WorkGroup';
import { groupBlocksIntoChunks } from './WorkGroup.logic';
import type { ContentBlock, TextBlock } from '@chamber/shared/types';

interface Props {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}

export function StreamingMessage({ blocks, isStreaming }: Props) {
  if (blocks.length === 0 && isStreaming) {
    return <ThinkingDots label="Thinking…" />;
  }

  const chunks = groupBlocksIntoChunks(blocks);
  const lastChunk = chunks[chunks.length - 1];
  // Hide the trailing indicator only when the final chunk is a work group
  // that actually contains a running tool — the running tool's spinner
  // conveys progress in that case. If the last chunk is work but every tool
  // is already done (and we're still streaming because more content is
  // expected), keep the dots so the UI doesn't look idle.
  const lastChunkHasRunningTool =
    !!lastChunk && lastChunk.kind === 'work' && hasRunningTool(lastChunk.entries);
  const showTrailingIndicator =
    isStreaming &&
    !lastChunkHasRunningTool &&
    (!lastChunk || lastChunk.kind !== 'text');

  return (
    <div className="flex flex-col">
      {chunks.map((chunk, i) => {
        const isLast = i === chunks.length - 1;
        if (chunk.kind === 'text') {
          return (
            <TextChunk
              key={chunk.id}
              block={chunk.block}
              streaming={Boolean(isStreaming) && isLast}
            />
          );
        }
        return (
          <WorkGroup
            key={chunk.id}
            entries={chunk.entries}
            isActive={Boolean(isStreaming) && isLast}
          />
        );
      })}
      {showTrailingIndicator && (
        <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}

function TextChunk({ block, streaming }: { block: TextBlock; streaming: boolean }) {
  return (
    <div
      className={cn(
        'prose prose-sm prose-invert max-w-none text-sm leading-relaxed',
        streaming && 'streaming',
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {block.content}
      </Markdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-genesis align-text-bottom" />
      )}
    </div>
  );
}

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:300ms]" />
      </div>
      <span className="text-xs">{label}</span>
    </div>
  );
}
