import { useCallback, useState } from 'react';

/**
 * Clipboard-copy state machine shared by every copy affordance. Returns the
 * transient `copied` flag (true for `resetMs` after a successful copy) and a
 * `copy` callback. The clipboard may be unavailable (e.g. tests); failures
 * silently no-op.
 */
export function useCopyToClipboard(resetMs = 1500): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    }).catch(() => {
      // Clipboard may be unavailable (e.g. tests). Silently no-op.
    });
  }, [resetMs]);

  return { copied, copy };
}
