import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { ChevronRight, Loader2, Check, X } from 'lucide-react';
import type { ToolCallBlock } from '../../../shared/types';

interface Props {
  block: ToolCallBlock;
}

export function ToolBlock({ block }: Props) {
  const [open, setOpen] = useState(block.status === 'running');

  const statusIcon = {
    running: <Loader2 className="w-3.5 h-3.5 animate-spin text-genesis" />,
    done: <Check className="w-3.5 h-3.5 text-emerald-400" />,
    error: <X className="w-3.5 h-3.5 text-destructive-foreground" />,
  }[block.status];

  const statusVariant = {
    running: 'outline' as const,
    done: 'secondary' as const,
    error: 'destructive' as const,
  }[block.status];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 rounded-md border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent/50 transition-colors rounded-md">
        <ChevronRight className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="flex items-center gap-1.5">
          {statusIcon}
          <span className="font-mono font-medium text-foreground">{block.toolName}</span>
        </span>
        <Badge variant={statusVariant} className="ml-auto text-[10px] px-1.5 py-0">
          {block.status}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {block.output && (
          <ScrollArea className="max-h-48">
            <pre className="px-3 pb-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
              {block.output}
            </pre>
          </ScrollArea>
        )}
        {block.error && (
          <p className="px-3 pb-2 text-xs text-destructive-foreground">{block.error}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
