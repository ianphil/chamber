import React, { useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import type { ModelInfo, ChatImageAttachment } from '../../../shared/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pastedSeq = useRef(0);

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
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setInput(next);
    // Restore caret after React commits
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const caret = start + text.length;
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
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, attachments, isStreaming, disabled, onSend, onStop]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
            placeholder={disabled ? 'Select a mind directory to start…' : (placeholder ?? 'Message your agent… (paste an image to attach)')}
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground disabled:opacity-50 overflow-y-auto"
          />

          <div className="flex items-center justify-between">
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
    </div>
  );
}
