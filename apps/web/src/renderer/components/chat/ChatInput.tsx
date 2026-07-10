import React, { useState, useRef, useCallback, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Smile } from 'lucide-react';
import { cn } from '../../lib/utils';
import { modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import { VOICE_DICTATION_MODEL_ID, type VoiceDictationConfig, type VoiceModelStatus } from '@chamber/shared/voice-types';
import type { ModelInfo, ChatImageAttachment } from '@chamber/shared/types';
import { useAppState } from '../../lib/store';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
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
import { TooltipFor } from '../ui/tooltip';
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
  /**
   * When provided, the textarea is controlled — `value` drives display and
   * `onValueChange` is invoked on every edit. Used by the single-agent chat
   * panel to persist drafts per active mind (#221). Omit to keep the prior
   * uncontrolled behavior (used by the chatroom panel).
   */
  value?: string;
  onValueChange?: (next: string) => void;
}

const IMAGE_TOKEN_RE = /\[📷 ([^\]]+)\]/g;
const SHORTCODE_POPOVER_GAP = 4;
const SHORTCODE_POPOVER_MARGIN = 8;
const SHORTCODE_POPOVER_MAX_HEIGHT = 240;
const SHORTCODE_POPOVER_MIN_WIDTH = 220;
const VOICE_MODEL_NOT_READY_TOOLTIP = 'Download the dictation model in Settings → Voice dictation';
const DEFAULT_VOICE_MODEL_STATUS: VoiceModelStatus = {
  id: VOICE_DICTATION_MODEL_ID,
  status: 'not-downloaded',
};

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

interface ShortcodeAnchor {
  top: number;
  left: number;
  height: number;
}

interface ShortcodePopoverPlacement {
  side: 'top' | 'bottom';
  style: React.CSSProperties;
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

function getShortcodePopoverPlacement(anchor: ShortcodeAnchor): ShortcodePopoverPlacement {
  const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
  const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
  const maxHeight = Math.min(
    SHORTCODE_POPOVER_MAX_HEIGHT,
    Math.max(0, viewportHeight - SHORTCODE_POPOVER_MARGIN * 2),
  );
  const bottomTop = anchor.top + anchor.height + SHORTCODE_POPOVER_GAP;
  const wouldClipBottom = bottomTop + maxHeight > viewportHeight - SHORTCODE_POPOVER_MARGIN;
  const top = wouldClipBottom
    ? Math.max(SHORTCODE_POPOVER_MARGIN, anchor.top - maxHeight - SHORTCODE_POPOVER_GAP)
    : bottomTop;
  const left = Math.min(
    Math.max(SHORTCODE_POPOVER_MARGIN, anchor.left),
    Math.max(SHORTCODE_POPOVER_MARGIN, viewportWidth - SHORTCODE_POPOVER_MIN_WIDTH - SHORTCODE_POPOVER_MARGIN),
  );

  return {
    side: wouldClipBottom ? 'top' : 'bottom',
    style: {
      position: 'fixed',
      top,
      left,
      zIndex: 60,
      maxHeight,
    },
  };
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, availableModels, selectedModel, onModelChange, placeholder, value, onValueChange }: Props) {
  const { featureFlags } = useAppState();
  const isControlled = value !== undefined;
  const [internalInput, setInternalInput] = useState('');
  const input = isControlled ? value : internalInput;
  const setInput = useCallback((next: string | ((prev: string) => string)) => {
    const resolved = typeof next === 'function' ? next(input) : next;
    if (isControlled) onValueChange?.(resolved);
    else setInternalInput(resolved);
  }, [input, isControlled, onValueChange]);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [shortcodeMatch, setShortcodeMatch] = useState<ShortcodeMatch | null>(null);
  const [shortcodeResults, setShortcodeResults] = useState<EmojiRecord[]>([]);
  const [shortcodeIndex, setShortcodeIndex] = useState(0);
  const [shortcodeAnchor, setShortcodeAnchor] = useState<ShortcodeAnchor | null>(null);
  const [isComposingForVoice, setIsComposingForVoice] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceDictationConfig | null>(null);
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus>(DEFAULT_VOICE_MODEL_STATUS);
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
  }, [resize, setInput]);

  useEffect(() => {
    if (!featureFlags.voiceDictation) {
      setVoiceConfig(null);
      return;
    }

    let cancelled = false;
    window.electronAPI.voice.getConfig().then((config) => {
      if (!cancelled) setVoiceConfig(config);
    }).catch(() => {
      if (!cancelled) setVoiceConfig(null);
    });
    const unsubscribe = window.electronAPI.voice.onConfigChanged((config) => {
      if (!cancelled) setVoiceConfig(config);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [featureFlags.voiceDictation]);

  useEffect(() => {
    if (!featureFlags.voiceDictation || !voiceConfig?.model.id) {
      setModelStatus(DEFAULT_VOICE_MODEL_STATUS);
      return;
    }

    let cancelled = false;
    let receivedProgress = false;
    const modelId = voiceConfig.model.id;
    window.electronAPI.voice.getModelStatus(modelId).then((status) => {
      if (!cancelled && !receivedProgress) setModelStatus(status);
    }).catch(() => {
      if (!cancelled && !receivedProgress) setModelStatus(DEFAULT_VOICE_MODEL_STATUS);
    });
    const unsubscribe = window.electronAPI.voice.onModelProgress((status) => {
      if (!cancelled && status.id === modelId) {
        receivedProgress = true;
        setModelStatus(status);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [featureFlags.voiceDictation, voiceConfig?.model.id]);

  const voiceEnabled = featureFlags.voiceDictation && voiceConfig?.enabled === true;
  const voiceModelReady = modelStatus.status === 'ready';
  const pttEnabled = voiceEnabled && !disabled && voiceModelReady && !shortcodeMatch && !isComposingForVoice;
  const voice = useVoiceDictation({
    enabled: pttEnabled,
    shortcut: voiceConfig?.shortcut ?? '',
    pushToTalk: voiceConfig?.pushToTalk ?? true,
    onFinalTranscript: (text) => insertAtCaret(`${text} `),
  });
  const voiceButtonTitle = modelStatus.status !== 'ready'
    ? VOICE_MODEL_NOT_READY_TOOLTIP
    : voice.error
      ? `Voice dictation error: ${voice.error}`
    : voice.state === 'listening'
      ? 'Click to stop dictation'
      : disabled
        ? undefined
        : 'Click to start dictation · Alt+Shift+V';

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
  }, [input, attachments, isStreaming, disabled, onSend, closeShortcode, setInput]);

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
    [shortcodeMatch, closeShortcode, resize, setInput],
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
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      onStop();
      return;
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
  const shortcodePopoverPlacement = shortcodeAnchor
    ? getShortcodePopoverPlacement(shortcodeAnchor)
    : null;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="focus-halo relative flex flex-col bg-secondary rounded-xl px-4 py-3 gap-2 border border-border transition-[border-color,box-shadow] duration-200">
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
              setIsComposingForVoice(true);
              closeShortcode();
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              setIsComposingForVoice(false);
            }}
            placeholder={placeholder ?? (disabled ? 'Select a mind directory to start…' : 'Message your agent… (paste an image to attach)')}
            aria-label="Message your agent"
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
                    className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-center"
                  >
                    <Smile className="w-4 h-4" />
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

              {voiceEnabled ? (
                <button
                  type="button"
                  aria-label="Dictate message"
                  aria-pressed={voice.state === 'listening'}
                  onMouseDown={(e) => {
                    updateSelectionRef();
                    e.preventDefault();
                  }}
                  onClick={() => {
                    if (voice.state === 'listening') void Promise.resolve(voice.stop()).catch(() => undefined);
                    else void Promise.resolve(voice.start()).catch(() => undefined);
                  }}
                  disabled={!voiceEnabled || disabled || modelStatus.status !== 'ready'}
                  title={voiceButtonTitle}
                  className={cn(
                    'h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-center',
                    voice.state === 'listening' && 'text-red-500',
                  )}
                >
                  <Mic className={cn('h-4 w-4', voice.state === 'listening' && 'animate-pulse')} />
                </button>
              ) : null}
              {voiceEnabled && voice.state === 'listening' ? (
                <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Listening…
                </span>
              ) : null}

              {availableModels.length > 0 ? (
                <Select
                  value={selectedModel ?? undefined}
                  onValueChange={onModelChange}
                  disabled={isStreaming || disabled}
                >
                  <SelectTrigger className="h-6 w-auto gap-1.5 border-none bg-transparent px-0 text-xs text-muted-foreground shadow-none hover:text-foreground focus:ring-0">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="top" sideOffset={8} align="start" collisionPadding={12}>
                    {availableModels.map((model) => {
                      const key = modelSelectionKeyFromModel(model);
                      return (
                        <SelectItem key={key} value={key} className="text-xs">
                          {model.name}
                          {model.provider === 'byo' ? <span className="ml-2 rounded bg-genesis/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-genesis">Local</span> : null}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {disabled ? '' : 'Loading models…'}
                </span>
              )}
            </div>

            <TooltipFor label={isStreaming ? 'Stop streaming (Esc)' : (canSubmit ? 'Send message (Enter)' : 'Type a message to send')}>
              <button
                onClick={isStreaming ? onStop : handleSubmit}
                disabled={isStreaming ? false : !canSubmit}
                aria-label={isStreaming ? 'Stop streaming (Escape)' : 'Send message'}
                className={cn(
                  'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
                  'transition-[background-color,color,transform,box-shadow] duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-secondary',
                  'active:scale-95',
                  isStreaming
                    ? 'bg-destructive text-destructive-foreground hover:opacity-80'
                    : canSubmit
                      ? 'bg-genesis text-genesis-foreground hover:bg-genesis hover:scale-[1.06] hover:shadow-[0_2px_8px_oklch(0.55_0.16_160/0.35)]'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
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
            </TooltipFor>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-2">
          <span className="opacity-70">
            {isStreaming ? 'Esc to stop' : 'Enter to send · Shift+Enter for newline'}
          </span>
          <span className="mx-2 opacity-30">·</span>
          AI agents can make mistakes. Verify important information.
        </p>
      </div>
      {shortcodeMatch && shortcodeAnchor && shortcodeResults.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="listbox"
              aria-label="Emoji shortcode suggestions"
              data-testid="shortcode-popover"
              data-side={shortcodePopoverPlacement?.side}
              style={shortcodePopoverPlacement?.style}
              className="min-w-[220px] overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
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
