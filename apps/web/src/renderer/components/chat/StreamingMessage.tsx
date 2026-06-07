import React, { memo, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import type { PluggableList } from 'unified';
import type { Components } from 'react-markdown';
import { cn } from '../../lib/utils';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { WorkGroup, hasRunningTool } from './WorkGroup';
import { groupBlocksIntoChunks } from './WorkGroup.logic';
import type { ContentBlock, TextBlock } from '@chamber/shared/types';

const REMARK_PLUGINS: PluggableList = [remarkGfm];
const REHYPE_PLUGINS: PluggableList = [[rehypeHighlight, { detect: true, ignoreMissing: true }]];
// While a chunk is still streaming we skip syntax highlighting entirely: it
// would re-tokenize the growing code block on every incoming token. Highlight
// once, after the chunk settles (streaming === false).
const REHYPE_PLUGINS_STREAMING: PluggableList = [];

// Extract a language hint from rehype-highlight's `hljs language-<lang>` class.
function extractLanguage(className: string | undefined): string | null {
  if (!className) return null;
  const langMatch = /language-(\S+)/.exec(className);
  return langMatch ? langMatch[1] : null;
}

// react-markdown injects a `node` prop on every renderer; strip it before
// spreading onto the DOM element to avoid React's unknown-prop warning.
function stripNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { node, ...rest } = props;
  return rest;
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const language = extractLanguage(className);
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    // children is the highlighted <code> tree; pull plain text from it.
    const text = typeof children === 'string'
      ? children
      : (() => {
          let acc = '';
          const walk = (node: React.ReactNode): void => {
            if (node == null || node === false) return;
            if (typeof node === 'string' || typeof node === 'number') {
              acc += String(node);
              return;
            }
            if (Array.isArray(node)) {
              node.forEach(walk);
              return;
            }
            if (React.isValidElement(node)) {
              walk((node.props as { children?: React.ReactNode }).children);
            }
          };
          walk(children);
          return acc;
        })();

    copy(text);
  }, [children, copy]);

  return (
    <div className="not-prose my-3 overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Wrap GFM tables in a horizontal-scroll container with zebra rows + cell
  // borders so they read as tables instead of bare data.
  table: (props) => (
    <div className="not-prose my-3 overflow-x-auto rounded-md border border-border">
      <table {...stripNode(props)} className="w-full border-collapse text-xs" />
    </div>
  ),
  thead: (props) => <thead {...stripNode(props)} className="bg-muted/60" />,
  th: (props) => (
    <th {...stripNode(props)} className="border-b border-border px-2.5 py-1.5 text-left font-medium" />
  ),
  td: (props) => (
    <td {...stripNode(props)} className="border-b border-border/50 px-2.5 py-1.5 align-top" />
  ),
  tr: (props) => (
    <tr {...stripNode(props)} className="even:bg-muted/20 hover:bg-accent/40 transition-colors" />
  ),
  // Detect fenced code blocks (the parent is <pre>); render via CodeBlock chrome.
  // Inline code keeps its prose styling.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const isFenced = typeof className === 'string' && /language-/.test(className);
    if (isFenced) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code {...rest} className={cn(className, 'whitespace-nowrap')}>
        {children}
      </code>
    );
  },
};

interface Props {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}

export function StreamingMessage({ blocks, isStreaming }: Props) {
  if (blocks.length === 0 && isStreaming) {
    return <ThinkingDots label="Thinking…" />;
  }

  if (blocks.length === 0) {
    return <p className="text-sm italic text-muted-foreground/60">No response.</p>;
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
    <div className="flex flex-col" aria-live="polite" aria-busy={Boolean(isStreaming)}>
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
        <div className="chamber-fade-in mt-2 flex items-center gap-1.5 text-muted-foreground">
          <BounceDots />
        </div>
      )}
    </div>
  );
}

const TextChunk = memo(function TextChunk({ block, streaming }: { block: TextBlock; streaming: boolean }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed',
        // Long unbroken tokens (Windows paths, URLs) must wrap inside the
        // message column instead of forcing a horizontal scrollbar on the
        // whole chat surface. `anywhere` keeps regular prose flowing.
        '[overflow-wrap:anywhere]',
      )}
    >
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={streaming ? REHYPE_PLUGINS_STREAMING : REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {block.content}
      </Markdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-[3px] rounded-full bg-genesis align-text-bottom chamber-caret" />
      )}
    </div>
  );
});

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="chamber-fade-in flex items-center gap-1.5 text-muted-foreground">
      <BounceDots />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function BounceDots() {
  return (
    <div className="flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-genesis [animation-delay:300ms]" />
    </div>
  );
}
