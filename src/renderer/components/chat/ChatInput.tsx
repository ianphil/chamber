import React, { useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import type { ModelInfo } from '../../../shared/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
  availableModels: ModelInfo[];
  selectedModel: string | null;
  onModelChange: (model: string) => void;
  placeholder?: string;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, availableModels, selectedModel, onModelChange, placeholder }: Props) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (isStreaming) {
      onStop();
      return;
    }
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isStreaming, disabled, onSend, onStop]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex flex-col bg-secondary rounded-xl px-4 py-3 gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Select a mind directory to start…' : (placeholder ?? 'Message your agent…')}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground disabled:opacity-50 max-h-[200px]"
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
                  : input.trim() && !disabled
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
