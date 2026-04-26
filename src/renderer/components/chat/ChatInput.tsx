import React, { useState, useRef, useCallback, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import type { ModelInfo, ChatImageAttachment } from '../../../shared/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import {
  Command,
  CommandList,
  CommandItem,
} from '../ui/command';
import { pushRecentEmoji } from '../../lib/emoji-recents';
import { loadEmojiData, type EmojiRecord } from '../../lib/emoji-data';
import { getTextareaCaretCoords } from '../../lib/textarea-caret';

const EmojiPickerLazy = React.lazy(() =>
  import('../ui/emoji-picker').then((m) => ({ default: m.EmojiPicker })),
);

interface Props {
  onSend: (message: string, attachments?: ChatImageAttachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  onModelChange: (model: string) => void;
  placeholder?: string;
}

const IMAGE_TOKEN_RE = /\[📷 ([^\]]+)\]/g;

// Boundary-aware shortcode detector. Matches a `:foo` token at the caret
// where:
//   - it sits at start-of-string or after whitespace / `(` / `[` / `{`
//   - the body has at least one letter (so `:30` does not trigger)
//   - the body is 2+ chars total
const SHORTCODE_RE = /(^|[\s([{])(:(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]{2,})$/i;

interface ShortcodeMatch {
  /** Start index of the `:` in the input. */
  start: number;
  /** Query text minus the leading colon. */
  query: string;
}

function detectShortcode(text: string, caret: number): ShortcodeMatch | null {
  const upToCaret = text.slice(0, caret);
  const m = SHORTCODE_RE.exec(upToCaret);
  if (!m) return null;
  const token = m[2];
  const start = caret - token.length;

  // Suppress if caret is inside an existing image token span.
  IMAGE_TOKEN_RE.lastIndex = 0;
  let img: RegExpExecArray | null;
  while ((img = IMAGE_TOKEN_RE.exec(text)) !== null) {
    const imgStart = img.index;
    const imgEnd = imgStart + img[0].length;
    if (start >= imgStart && start < imgEnd) return null;
  }

  return { start, query: token.slice(1).toLowerCase() };
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mime] ?? 'png';
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read image'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, availableModels, selectedModel, onModelChange, placeholder }: Props) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [shortcodeMatch, setShortcodeMatch] = useState<ShortcodeMatch | null>(null);
  const [shortcodeResults, setShortcodeResults] = useState<EmojiRecord[]>([]);
  const [shortcodeIndex, setShortcodeIndex] = useState(0);
  const [shortcodeAnchor, setShortcodeAnchor] = useState<{ top: number; left: number; height: number } | null>(null);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pastedSeq = useRef(0);
  // Last known textarea selection — preserved across blur (e.g., when the
  // emoji popover steals focus) so insertAtCaret can land in the right place.
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const updateSelectionRef = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    selectionRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }, []);

  const closeShortcode = useCallback(() => {
    setShortcodeMatch(null);
    setShortcodeResults([]);
    setShortcodeIndex(0);
    setShortcodeAnchor(null);
  }, []);

  const getMaxHeight = useCallback((el: HTMLTextAreaElement) => {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    return Math.round(lineHeight * 13);
  }, []);

  const resize = useCallback((el: HTMLTextAreaElement) => {
    const maxHeight = getMaxHeight(el);
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = newHeight + 'px';
    el.style.maxHeight = maxHeight + 'px';
    if (el.scrollHeight > maxHeight) {
      el.scrollTop = el.scrollHeight;
    }
  }, [getMaxHeight]);

  const insertAtCaret = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setInput((v) => v + text);
      return;
    }
    const focused = document.activeElement === el;
    const saved = selectionRef.current;
    const start = focused ? (el.selectionStart ?? el.value.length) : (saved?.start ?? el.value.length);
    const end = focused ? (el.selectionEnd ?? el.value.length) : (saved?.end ?? start);
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setInput(next);
    const caret = start + text.length;
    selectionRef.current = { start: caret, end: caret };
    // Restore caret after React commits
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.setSelectionRange(caret, caret);
      resize(textareaRef.current);
    });
  }, [resize]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const data = await readAsBase64(file);
        const mimeType = file.type || 'image/png';
        const ext = mimeToExt(mimeType);
        const id = (++pastedSeq.current).toString(36);
        const name = `image-${id}.${ext}`;
        setAttachments((prev) => [...prev, { name, mimeType, data }]);
        insertAtCaret(`[📷 ${name}]`);
      } catch {
        // ignore unreadable clipboard entries
      }
    }
  }, [insertAtCaret]);

  const handleSubmit = useCallback(() => {
    if (isStreaming) {
      onStop();
      return;
    }
    const hasText = input.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || disabled) return;

    // Only include attachments whose tokens still appear in the text
    const tokensInText = new Set<string>();
    let m: RegExpExecArray | null;
    IMAGE_TOKEN_RE.lastIndex = 0;
    while ((m = IMAGE_TOKEN_RE.exec(input)) !== null) {
      tokensInText.add(m[1]);
    }
    const kept = attachments.filter((a) => tokensInText.has(a.name));

    onSend(input, kept.length > 0 ? kept : undefined);
    setInput('');
    setAttachments([]);
    setEmojiOpen(false);
    closeShortcode();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, attachments, isStreaming, disabled, onSend, onStop, closeShortcode]);

  const acceptShortcode = useCallback(
    (record: EmojiRecord) => {
      const match = shortcodeMatch;
      if (!match) return;
      const el = textareaRef.current;
      if (!el) return;
      const before = el.value.slice(0, match.start);
      const afterStart = match.start + 1 + match.query.length; // include the `:`
      const after = el.value.slice(afterStart);
      const next = before + record.emoji + after;
      setInput(next);
      pushRecentEmoji(record.emoji);
      const caret = before.length + record.emoji.length;
      selectionRef.current = { start: caret, end: caret };
      // Prune attachments whose tokens may have been removed.
      setAttachments((prev) => {
        const tokens = new Set<string>();
        let m: RegExpExecArray | null;
        IMAGE_TOKEN_RE.lastIndex = 0;
        while ((m = IMAGE_TOKEN_RE.exec(next)) !== null) tokens.add(m[1]);
        const pruned = prev.filter((a) => tokens.has(a.name));
        return pruned.length === prev.length ? prev : pruned;
      });
      closeShortcode();
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
        resize(textareaRef.current);
      });
    },
    [shortcodeMatch, closeShortcode, resize],
  );

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      insertAtCaret(emoji);
      pushRecentEmoji(emoji);
      setEmojiOpen(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [insertAtCaret],
  );

  // Load shortcode results when the query changes.
  useEffect(() => {
    if (!shortcodeMatch) return;
    let cancelled = false;
    loadEmojiData().then((ds) => {
      if (cancelled) return;
      const results = ds.search(shortcodeMatch.query, 10);
      setShortcodeResults(results);
      setShortcodeIndex(0);
      if (results.length === 0) {
        // Keep the match open so re-typing can re-trigger; just no results.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shortcodeMatch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1) IME composition — let the IME own the key.
    if (isComposingRef.current || (e.nativeEvent as KeyboardEvent).isComposing) {
      return;
    }
    // 2) Shortcode popover open — intercept navigation / accept / dismiss.
    if (shortcodeMatch && shortcodeResults.length > 0) {
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const pick = shortcodeResults[shortcodeIndex] ?? shortcodeResults[0];
        if (pick) acceptShortcode(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeShortcode();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setShortcodeIndex((i) => Math.min(i + 1, shortcodeResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setShortcodeIndex((i) => Math.max(i - 1, 0));
        return;
      }
    }
    // 3) Default Enter submit / Shift+Enter newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setInput(next);
    resize(e.target);
    // Drop attachments whose tokens were removed by the user
    setAttachments((prev) => {
      const tokens = new Set<string>();
      let m: RegExpExecArray | null;
      IMAGE_TOKEN_RE.lastIndex = 0;
      while ((m = IMAGE_TOKEN_RE.exec(next)) !== null) tokens.add(m[1]);
      const pruned = prev.filter((a) => tokens.has(a.name));
      return pruned.length === prev.length ? prev : pruned;
    });
    // Shortcode detection — suppressed during IME composition.
    if (isComposingRef.current) {
      closeShortcode();
      return;
    }
    const caret = e.target.selectionStart ?? next.length;
    const match = detectShortcode(next, caret);
    if (match) {
      setShortcodeMatch(match);
      setShortcodeIndex(0);
      // Anchor at the caret in viewport coords.
      const coords = getTextareaCaretCoords(e.target, caret);
      setShortcodeAnchor(coords);
    } else if (shortcodeMatch) {
      closeShortcode();
    }
  };

  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !disabled;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex flex-col bg-secondary rounded-xl px-4 py-3 gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={updateSelectionRef}
            onBlur={updateSelectionRef}
            onCompositionStart={() => {
              isComposingRef.current = true;
              closeShortcode();
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder={disabled ? 'Select a mind directory to start…' : (placeholder ?? 'Message your agent… (paste an image to attach)')}
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground disabled:opacity-50 overflow-y-auto"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Insert emoji"
                    aria-haspopup="dialog"
                    aria-expanded={emojiOpen}
                    disabled={disabled}
                    onMouseDown={(e) => {
                      // Preserve textarea selection across the focus shift.
                      updateSelectionRef();
                      e.preventDefault();
                    }}
                    onClick={() => setEmojiOpen((v) => !v)}
                    className="h-6 w-6 shrink-0 rounded-md text-base text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-center"
                  >
                    😀
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  className="p-0"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    textareaRef.current?.focus();
                  }}
                >
                  <Suspense fallback={<div className="h-[340px] w-[320px] flex items-center justify-center text-xs text-muted-foreground">Loading emoji…</div>}>
                    <EmojiPickerLazy onSelect={handleEmojiSelect} />
                  </Suspense>
                </PopoverContent>
              </Popover>

              {availableModels.length > 0 ? (
                <Select
                  value={selectedModel ?? undefined}
                  onValueChange={onModelChange}
                  disabled={isStreaming}
                >
                  <SelectTrigger className="h-6 w-auto gap-1.5 border-none bg-transparent px-0 text-xs text-muted-foreground shadow-none hover:text-foreground focus:ring-0">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model.id} value={model.id} className="text-xs">
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {disabled ? '' : 'Loading models…'}
                </span>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={disabled && !isStreaming}
              className={cn(
                'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                isStreaming
                  ? 'bg-destructive-foreground text-background hover:opacity-80'
                  : canSubmit
                    ? 'bg-primary text-primary-foreground hover:opacity-80'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {isStreaming ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="2" y="2" width="10" height="10" rx="1" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="12" x2="7" y2="2" />
                  <polyline points="3,6 7,2 11,6" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-2">
          AI agents can make mistakes. Verify important information.
        </p>
      </div>
      {shortcodeMatch && shortcodeAnchor && shortcodeResults.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="listbox"
              aria-label="Emoji shortcode suggestions"
              data-testid="shortcode-popover"
              style={{
                position: 'fixed',
                top: shortcodeAnchor.top + shortcodeAnchor.height + 4,
                left: shortcodeAnchor.left,
                zIndex: 60,
              }}
              className="min-w-[220px] rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              <Command shouldFilter={false}>
                <CommandList>
                  {shortcodeResults.map((rec, i) => (
                    <CommandItem
                      key={rec.hexcode}
                      value={rec.shortcodes[0]}
                      data-selected={i === shortcodeIndex || undefined}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        acceptShortcode(rec);
                      }}
                      onMouseEnter={() => setShortcodeIndex(i)}
                    >
                      <span className="text-base">{rec.emoji}</span>
                      <span className="text-xs text-muted-foreground">
                        :{rec.shortcodes[0]}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
