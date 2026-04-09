import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { ChevronRight, Brain } from 'lucide-react';
import type { ReasoningBlock as ReasoningBlockType } from '../../../shared/types';

interface Props {
  block: ReasoningBlockType;
  isStreaming?: boolean;
}

export function ReasoningBlock({ block, isStreaming }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRight className={cn('w-3 h-3 transition-transform', open && 'rotate-90')} />
        <Brain className="w-3 h-3" />
        <span>{isStreaming ? 'Thinking…' : 'Thought'}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 px-4 py-2 text-[11px] font-mono text-muted-foreground/70 whitespace-pre-wrap break-words leading-relaxed border-l-2 border-border">
          {block.content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
