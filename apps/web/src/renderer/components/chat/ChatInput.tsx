import React, { useState, useRef, useCallback, useMemo, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Paperclip, Smile } from 'lucide-react';
import { cn } from '../../lib/utils';
import { modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import { VOICE_DICTATION_MODEL_ID, type VoiceDictationConfig, type VoiceModelStatus } from '@chamber/shared/voice-types';
import type { ModelInfo, ChatImageAttachment } from '@chamber/shared/types';
import { useAppState, useAppDispatch } from '../../lib/store';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { useNewConversation } from '../../hooks/useNewConversation';
import { Logger } from '../../lib/logger';
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
import {
  imageToken,
  fileToken,
  collectImageIds,
  collectFileIds,
  isInsideAttachmentToken,
  detectMention,
  toMentionables,
  filterMentionables,
  detectSlash,
  filterSlashCommands,
  isImageFile,
  isTextLikeFile,
  buildMessageWithTextAttachments,
  SLASH_COMMANDS,
  MAX_TEXT_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  type Mentionable,
  type MentionMatch,
  type SlashMatch,
  type SlashCommandId,
  type TextFileAttachment,
} from '../../lib/composer';

// Composer attachment payload state, scoped per conversation. Image payloads
// carry an opaque id so their inline token can never collide with a filename.
interface ComposerImageAttachment extends ChatImageAttachment {
  id: number;
}

interface AttachmentBucket {
  images: ComposerImageAttachment[];
  texts: TextFileAttachment[];
}

const EMPTY_BUCKET: AttachmentBucket = { images: [], texts: [] };
// Bucket keys for the controlled (single-agent, per-mind) and uncontrolled
// (chatroom) hosts. Draft text is already per-mind; payloads must follow it so
// switching agents never leaks one mind's attachments into another's compose.
const NO_MIND_BUCKET_KEY = '__no-mind__';
const UNCONTROLLED_BUCKET_KEY = '__uncontrolled__';

const log = Logger.create('ChatInput');

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

const MENU_POPOVER_GAP = 4;
const MENU_POPOVER_MARGIN = 8;
const MENU_POPOVER_MAX_HEIGHT = 240;
const MENU_POPOVER_MIN_WIDTH = 220;
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

interface MenuAnchor {
  top: number;
  left: number;
  height: number;
}

interface MenuPopoverPlacement {
  side: 'top' | 'bottom';
  style: React.CSSProperties;
}

function detectShortcode(text: string, caret: number): ShortcodeMatch | null {
  const upToCaret = text.slice(0, caret);
  const m = SHORTCODE_RE.exec(upToCaret);
  if (!m) return null;
  const token = m[2];
  const start = caret - token.length;

  // Suppress if the caret is inside an existing attachment token span.
  if (isInsideAttachmentToken(text, start)) return null;

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

function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Build the composer notice for files that could not be attached. Returns null
// when nothing was skipped so the notice line can be cleared.
function buildSkipNotice(skipped: string[], oversized: string[]): string | null {
  const notices: string[] = [];
  if (skipped.length > 0) {
    notices.push(`Skipped ${skipped.length} unsupported file${skipped.length > 1 ? 's' : ''}: ${skipped.join(', ')}`);
  }
  if (oversized.length > 0) {
    notices.push(`Skipped ${oversized.length} oversized file${oversized.length > 1 ? 's' : ''}: ${oversized.join(', ')}`);
  }
  return notices.length > 0 ? notices.join(' · ') : null;
}

function getMenuPopoverPlacement(anchor: MenuAnchor): MenuPopoverPlacement {
  const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
  const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
  const maxHeight = Math.min(
    MENU_POPOVER_MAX_HEIGHT,
    Math.max(0, viewportHeight - MENU_POPOVER_MARGIN * 2),
  );
  const bottomTop = anchor.top + anchor.height + MENU_POPOVER_GAP;
  const wouldClipBottom = bottomTop + maxHeight > viewportHeight - MENU_POPOVER_MARGIN;
  const top = wouldClipBottom
    ? Math.max(MENU_POPOVER_MARGIN, anchor.top - maxHeight - MENU_POPOVER_GAP)
    : bottomTop;
  const left = Math.min(
    Math.max(MENU_POPOVER_MARGIN, anchor.left),
    Math.max(MENU_POPOVER_MARGIN, viewportWidth - MENU_POPOVER_MIN_WIDTH - MENU_POPOVER_MARGIN),
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

interface MenuNav {
  count: number;
  index: number;
  setIndex: React.Dispatch<React.SetStateAction<number>>;
  onAccept: () => void;
  onClose: () => void;
  /** When true, Enter/Tab are swallowed even with no results (prevents send). */
  swallowEnterWhenEmpty?: boolean;
}

// Shared caret-menu keyboard handling for the mention and slash popovers.
// Returns true when the key was consumed so the caller can stop processing.
function handleMenuKeydown(e: React.KeyboardEvent<HTMLTextAreaElement>, menu: MenuNav): boolean {
  const isAccept = (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab';
  if (isAccept && menu.count > 0) {
    e.preventDefault();
    menu.onAccept();
    return true;
  }
  if (isAccept && menu.swallowEnterWhenEmpty) {
    e.preventDefault();
    menu.onClose();
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    menu.onClose();
    return true;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    menu.setIndex((i) => Math.min(i + 1, menu.count - 1));
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    menu.setIndex((i) => Math.max(i - 1, 0));
    return true;
  }
  return false;
}

// Portal-rendered caret menu shared by the shortcode, mention and slash
// popovers so placement, chrome and the cmdk wrapper live in one place.
function CaretPopover({
  anchor,
  testId,
  ariaLabel,
  children,
}: {
  anchor: MenuAnchor;
  testId: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (typeof document === 'undefined') return null;
  const placement = getMenuPopoverPlacement(anchor);
  return createPortal(
    <div
      role="listbox"
      aria-label={ariaLabel}
      data-testid={testId}
      data-side={placement.side}
      style={placement.style}
      className="min-w-[220px] overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <Command shouldFilter={false}>
        <CommandList>{children}</CommandList>
      </Command>
    </div>,
    document.body,
  );
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, availableModels, selectedModel, onModelChange, placeholder, value, onValueChange }: Props) {
  const { featureFlags, minds, activeMindId } = useAppState();
  const dispatch = useAppDispatch();
  const newConversation = useNewConversation();
  const isControlled = value !== undefined;
  const [internalInput, setInternalInput] = useState('');
  const input = isControlled ? value : internalInput;
  const setInput = useCallback((next: string | ((prev: string) => string)) => {
    const resolved = typeof next === 'function' ? next(input) : next;
    if (isControlled) onValueChange?.(resolved);
    else setInternalInput(resolved);
  }, [input, isControlled, onValueChange]);
  const [attachmentsByKey, setAttachmentsByKey] = useState<Record<string, AttachmentBucket>>({});
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [shortcodeMatch, setShortcodeMatch] = useState<ShortcodeMatch | null>(null);
  const [shortcodeResults, setShortcodeResults] = useState<EmojiRecord[]>([]);
  const [shortcodeIndex, setShortcodeIndex] = useState(0);
  const [shortcodeAnchor, setShortcodeAnchor] = useState<MenuAnchor | null>(null);
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionAnchor, setMentionAnchor] = useState<MenuAnchor | null>(null);
  const [slashMatch, setSlashMatch] = useState<SlashMatch | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashAnchor, setSlashAnchor] = useState<MenuAnchor | null>(null);
  const [isComposingForVoice, setIsComposingForVoice] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceDictationConfig | null>(null);
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus>(DEFAULT_VOICE_MODEL_STATUS);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastedSeq = useRef(0);
  const attachmentIdRef = useRef(0);
  // Last known textarea selection — preserved across blur (e.g., when the
  // emoji popover steals focus) so insertAtCaret can land in the right place.
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  // Which attachment bucket the current draft belongs to. Mirrors the per-mind
  // draft partitioning so payloads travel with the text when agents switch.
  const conversationKey = isControlled ? (activeMindId ?? NO_MIND_BUCKET_KEY) : UNCONTROLLED_BUCKET_KEY;
  // Live mirror of the key so async file-read completions can tell whether the
  // user has since switched agents (and skip stealing caret/focus if so).
  const conversationKeyRef = useRef(conversationKey);
  conversationKeyRef.current = conversationKey;
  const activeBucket = attachmentsByKey[conversationKey] ?? EMPTY_BUCKET;
  const activeImages = activeBucket.images;
  const activeTexts = activeBucket.texts;

  const updateBucket = useCallback((key: string, fn: (bucket: AttachmentBucket) => AttachmentBucket) => {
    setAttachmentsByKey((prev) => {
      const current = prev[key] ?? EMPTY_BUCKET;
      const next = fn(current);
      if (next === current) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  const mentionables = useMemo<Mentionable[]>(() => toMentionables(minds), [minds]);
  const mentionResults = useMemo<Mentionable[]>(
    () => (mentionMatch ? filterMentionables(mentionables, mentionMatch.query) : []),
    [mentionMatch, mentionables],
  );
  const availableSlashCommands = useMemo(
    () => (availableModels.length > 0 ? SLASH_COMMANDS : SLASH_COMMANDS.filter((c) => c.id !== 'model')),
    [availableModels.length],
  );
  const slashResults = useMemo(
    () => (slashMatch ? filterSlashCommands(availableSlashCommands, slashMatch.query) : []),
    [slashMatch, availableSlashCommands],
  );

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

  const closeMention = useCallback(() => {
    setMentionMatch(null);
    setMentionIndex(0);
    setMentionAnchor(null);
  }, []);

  const closeSlash = useCallback(() => {
    setSlashMatch(null);
    setSlashIndex(0);
    setSlashAnchor(null);
  }, []);

  const closeAllMenus = useCallback(() => {
    closeShortcode();
    closeMention();
    closeSlash();
  }, [closeShortcode, closeMention, closeSlash]);

  // Drop attachments from the active bucket whose token id no longer appears in
  // the given text. Matching is by opaque id so odd filenames cannot desync it.
  const pruneAttachments = useCallback((next: string) => {
    const imageIds = collectImageIds(next);
    const fileIds = collectFileIds(next);
    updateBucket(conversationKey, (bucket) => {
      const images = bucket.images.filter((a) => imageIds.has(a.id));
      const texts = bucket.texts.filter((a) => fileIds.has(a.id));
      if (images.length === bucket.images.length && texts.length === bucket.texts.length) return bucket;
      return { images, texts };
    });
  }, [conversationKey, updateBucket]);

  const resetComposer = useCallback(() => {
    setInput('');
    updateBucket(conversationKey, (bucket) => (bucket === EMPTY_BUCKET ? bucket : EMPTY_BUCKET));
    setAttachmentNotice(null);
    closeAllMenus();
    setEmojiOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [setInput, conversationKey, updateBucket, closeAllMenus]);

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

  // Snapshot the draft + caret that own an attachment pick, so an async file
  // read that resolves after an agent switch composes against the origin draft
  // rather than whatever draft is now live in the shared textarea.
  const captureDraft = useCallback(() => {
    const el = textareaRef.current;
    const base = el?.value ?? input;
    const focused = el ? document.activeElement === el : false;
    const caret = el
      ? (focused ? (el.selectionStart ?? base.length) : (selectionRef.current?.start ?? base.length))
      : base.length;
    return { base, caret };
  }, [input]);

  // File payloads and their inline tokens are committed together, against the
  // captured base draft and via the captured (origin-mind) writer. The textarea
  // caret/focus is only touched when the origin mind is still active.
  const commitAttachments = useCallback((
    key: string,
    base: string,
    caret: number,
    images: ComposerImageAttachment[],
    texts: TextFileAttachment[],
    tokens: string[],
  ) => {
    if (images.length === 0 && texts.length === 0) return;
    updateBucket(key, (b) => ({ images: [...b.images, ...images], texts: [...b.texts, ...texts] }));
    let draft = base;
    let pos = Math.max(0, Math.min(caret, base.length));
    for (const token of tokens) {
      draft = draft.slice(0, pos) + token + draft.slice(pos);
      pos += token.length;
    }
    setInput(draft);
    if (key === conversationKeyRef.current) {
      selectionRef.current = { start: pos, end: pos };
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(pos, pos);
        resize(el);
      });
    }
  }, [updateBucket, setInput, resize]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    // Capture the bucket and base draft at pick time so a mid-read agent switch
    // cannot misfile the payload or corrupt the origin/destination drafts.
    const key = conversationKey;
    const { base, caret } = captureDraft();
    const images: ComposerImageAttachment[] = [];
    const texts: TextFileAttachment[] = [];
    const tokens: string[] = [];
    const skipped: string[] = [];
    const oversized: string[] = [];
    for (const file of files) {
      if (isImageFile({ name: file.name, mimeType: file.type })) {
        if (file.size > MAX_IMAGE_FILE_BYTES) {
          oversized.push(file.name);
          continue;
        }
        try {
          const data = await readAsBase64(file);
          const id = ++attachmentIdRef.current;
          images.push({ id, name: file.name, mimeType: file.type || 'image/png', data });
          tokens.push(imageToken(id, file.name));
        } catch {
          skipped.push(file.name);
        }
      } else if (isTextLikeFile({ name: file.name, mimeType: file.type })) {
        if (file.size > MAX_TEXT_FILE_BYTES) {
          oversized.push(file.name);
          continue;
        }
        try {
          const content = await readAsText(file);
          const id = ++attachmentIdRef.current;
          texts.push({ id, name: file.name, mimeType: file.type || 'text/plain', content });
          tokens.push(fileToken(id, file.name));
        } catch {
          skipped.push(file.name);
        }
      } else {
        skipped.push(file.name);
      }
    }
    commitAttachments(key, base, caret, images, texts, tokens);
    setAttachmentNotice(buildSkipNotice(skipped, oversized));
  }, [conversationKey, captureDraft, commitAttachments]);

  const acceptMention = useCallback((item: Mentionable) => {
    const match = mentionMatch;
    if (!match) return;
    const source = textareaRef.current?.value ?? input;
    const before = source.slice(0, match.start);
    const afterStart = match.start + 1 + match.query.length; // include the `@`
    const after = source.slice(afterStart);
    const token = `@${item.name} `;
    const next = before + token + after;
    setInput(next);
    const caret = before.length + token.length;
    selectionRef.current = { start: caret, end: caret };
    closeMention();
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(caret, caret);
      resize(textareaRef.current);
    });
  }, [mentionMatch, input, closeMention, resize, setInput]);

  const runSlashCommand = useCallback((id: SlashCommandId) => {
    resetComposer();
    switch (id) {
      case 'clear':
        break;
      case 'model':
        if (availableModels.length > 0) setModelMenuOpen(true);
        break;
      case 'settings':
        dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
        break;
      case 'new':
        // Guard client-side: starting a fresh conversation mid-stream would
        // race the in-flight turn. Ignore until streaming settles.
        if (activeMindId && !isStreaming) {
          void newConversation(activeMindId).catch((error: unknown) => {
            log.error('Failed to start new conversation:', error);
          });
        }
        break;
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [resetComposer, availableModels.length, dispatch, activeMindId, isStreaming, newConversation]);

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
  const pttEnabled = voiceEnabled && !disabled && voiceModelReady && !shortcodeMatch && !mentionMatch && !slashMatch && !isComposingForVoice;
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
    const key = conversationKey;
    const { base, caret } = captureDraft();
    const images: ComposerImageAttachment[] = [];
    const tokens: string[] = [];
    const oversized: string[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const mimeType = file.type || 'image/png';
      const name = `image-${(++pastedSeq.current).toString(36)}.${mimeToExt(mimeType)}`;
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        oversized.push(name);
        continue;
      }
      try {
        const data = await readAsBase64(file);
        const id = ++attachmentIdRef.current;
        images.push({ id, name, mimeType, data });
        tokens.push(imageToken(id, name));
      } catch {
        // ignore unreadable clipboard entries
      }
    }
    commitAttachments(key, base, caret, images, [], tokens);
    setAttachmentNotice(buildSkipNotice([], oversized));
  }, [conversationKey, captureDraft, commitAttachments]);

  const handleSubmit = useCallback(() => {
    if (isStreaming) {
      return;
    }
    // A bare slash command is never sent as a message; it runs from the menu.
    if (slashMatch) return;

    const bucket = attachmentsByKey[conversationKey] ?? EMPTY_BUCKET;
    const keptImageIds = collectImageIds(input);
    const keptImages: ChatImageAttachment[] = bucket.images
      .filter((a) => keptImageIds.has(a.id))
      .map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }));
    const hasText = input.trim().length > 0;
    const hasAttachments = keptImages.length > 0 || collectFileIds(input).size > 0;
    if ((!hasText && !hasAttachments) || disabled) return;

    // Fold any text-file contents into the outgoing prompt; images ride along
    // as blob attachments and keep their inline marker token.
    const message = buildMessageWithTextAttachments(input, bucket.texts);
    onSend(message, keptImages.length > 0 ? keptImages : undefined);
    resetComposer();
  }, [input, attachmentsByKey, conversationKey, slashMatch, isStreaming, disabled, onSend, resetComposer]);

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
      pruneAttachments(next);
      closeShortcode();
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
        resize(textareaRef.current);
      });
    },
    [shortcodeMatch, closeShortcode, pruneAttachments, resize, setInput],
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
    // 2b) Mention popover open — only intercept when it has visible results, so
    // arrows/Escape/Enter fall through to normal editing when the query matches
    // no agent (the popover is not rendered in that case).
    if (mentionMatch && mentionResults.length > 0 && handleMenuKeydown(e, {
      count: mentionResults.length,
      index: mentionIndex,
      setIndex: setMentionIndex,
      onAccept: () => {
        const pick = mentionResults[mentionIndex] ?? mentionResults[0];
        if (pick) acceptMention(pick);
      },
      onClose: closeMention,
    })) {
      return;
    }
    // 2c) Slash command menu open — never let the slash text submit.
    if (slashMatch && handleMenuKeydown(e, {
      count: slashResults.length,
      index: slashIndex,
      setIndex: setSlashIndex,
      onAccept: () => {
        const pick = slashResults[slashIndex] ?? slashResults[0];
        if (pick) runSlashCommand(pick.id);
      },
      onClose: closeSlash,
      swallowEnterWhenEmpty: true,
    })) {
      return;
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
    // Drop attachments whose tokens were removed by the user.
    pruneAttachments(next);
    // Menu detection — suppressed during IME composition.
    if (isComposingRef.current) {
      closeAllMenus();
      return;
    }
    const caret = e.target.selectionStart ?? next.length;
    // A bare `/command` at the very start opens the slash menu.
    const slash = detectSlash(next);
    if (slash) {
      setSlashMatch(slash);
      setSlashIndex(0);
      setSlashAnchor(getTextareaCaretCoords(e.target, caret));
      closeShortcode();
      closeMention();
      return;
    } else if (slashMatch) {
      closeSlash();
    }
    // `@name` at the caret opens the mention menu.
    const mention = detectMention(next, caret);
    if (mention) {
      setMentionMatch(mention);
      setMentionIndex(0);
      setMentionAnchor(getTextareaCaretCoords(e.target, caret));
      closeShortcode();
      return;
    } else if (mentionMatch) {
      closeMention();
    }
    // `:shortcode` emoji suggestions.
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

  const canSubmit = !slashMatch
    && (input.trim().length > 0 || activeImages.length > 0 || activeTexts.length > 0)
    && !disabled;

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
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                data-testid="composer-file-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length > 0) void handleFiles(files);
                }}
              />
              <button
                type="button"
                aria-label="Attach files"
                disabled={disabled}
                onMouseDown={(e) => {
                  // Preserve textarea selection across the focus shift.
                  updateSelectionRef();
                  e.preventDefault();
                }}
                onClick={() => fileInputRef.current?.click()}
                className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent flex items-center justify-center"
              >
                <Paperclip className="w-4 h-4" />
              </button>

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
                  open={modelMenuOpen}
                  onOpenChange={setModelMenuOpen}
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

          {attachmentNotice ? (
            <p role="status" className="text-xs text-amber-500">
              {attachmentNotice}
            </p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-2">
          <span className="opacity-70">
            {isStreaming ? 'Esc to stop' : 'Enter to send · Shift+Enter for newline'}
          </span>
          <span className="mx-2 opacity-30">·</span>
          AI agents can make mistakes. Verify important information.
        </p>
      </div>
      {shortcodeMatch && shortcodeAnchor && shortcodeResults.length > 0 ? (
        <CaretPopover anchor={shortcodeAnchor} testId="shortcode-popover" ariaLabel="Emoji shortcode suggestions">
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
        </CaretPopover>
      ) : null}
      {mentionMatch && mentionAnchor && mentionResults.length > 0 ? (
        <CaretPopover anchor={mentionAnchor} testId="mention-popover" ariaLabel="Agent mention suggestions">
          {mentionResults.map((item, i) => (
            <CommandItem
              key={item.mindId}
              value={item.name}
              data-selected={i === mentionIndex || undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptMention(item);
              }}
              onMouseEnter={() => setMentionIndex(i)}
            >
              <span className="text-sm font-medium">@{item.name}</span>
            </CommandItem>
          ))}
        </CaretPopover>
      ) : null}
      {slashMatch && slashAnchor ? (
        <CaretPopover anchor={slashAnchor} testId="slash-popover" ariaLabel="Slash commands">
          {slashResults.length > 0 ? (
            slashResults.map((command, i) => (
              <CommandItem
                key={command.id}
                value={command.name}
                data-selected={i === slashIndex || undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  runSlashCommand(command.id);
                }}
                onMouseEnter={() => setSlashIndex(i)}
              >
                <span className="text-sm font-medium">{command.name}</span>
                <span className="text-xs text-muted-foreground">{command.hint}</span>
              </CommandItem>
            ))
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching commands</div>
          )}
        </CaretPopover>
      ) : null}
    </div>
  );
}
