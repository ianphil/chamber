import { useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

/**
 * Hover-revealed action row for a completed assistant turn. Mirrors the
 * M365/Anthropic pattern: actions stay out of the way until the row is
 * hovered (or the button is focused for keyboard users), then offer a quick
 * copy of the message's plain-text content. Shared by single-agent chat and
 * the chatroom transcript.
 */
export function MessageActions({ content }: { content: string }) {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = useCallback(() => copy(content), [copy, content]);

  return (
    <div className="mt-1.5 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy message'}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
