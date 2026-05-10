import * as React from 'react';
import { EmojiPicker as FrimousseEmojiPicker } from 'frimousse';
import { cn } from '@/renderer/lib/utils';
import {
  FRIMOUSSE_OFFLINE_URL,
  installFrimousseDataInterceptor,
} from '@/renderer/lib/emoji-data';
import {
  getEmojiSkinTone,
  setEmojiSkinTone,
  type EmojiSkinTone,
} from '@/renderer/lib/emoji-skin-tone';

// Install the offline data interceptor at module load (before the picker
// renders) so frimousse's internal fetch sees our shim from the first call.
installFrimousseDataInterceptor();

export interface EmojiPickerProps {
  onSelect: (emoji: string, label: string) => void;
  className?: string;
}

export function EmojiPicker({ onSelect, className }: EmojiPickerProps) {
  const [skinTone, setSkinToneState] = React.useState<EmojiSkinTone>(() =>
    getEmojiSkinTone(),
  );

  return (
    <FrimousseEmojiPicker.Root
      data-slot="emoji-picker"
      emojibaseUrl={FRIMOUSSE_OFFLINE_URL}
      skinTone={skinTone}
      onEmojiSelect={({ emoji, label }) => onSelect(emoji, label)}
      className={cn(
        'isolate flex h-[340px] w-[320px] flex-col bg-popover text-popover-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <FrimousseEmojiPicker.Search
          placeholder="Search emoji…"
          className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <FrimousseEmojiPicker.SkinTone>
          {({ skinTone: current, setSkinTone, skinToneVariations }) => {
            const variation = skinToneVariations.find((v) => v.skinTone === current);
            const next =
              skinToneVariations[
                (skinToneVariations.indexOf(variation ?? skinToneVariations[0]) + 1) %
                  skinToneVariations.length
              ];
            return (
              <button
                type="button"
                aria-label="Cycle emoji skin tone"
                onClick={() => {
                  setSkinTone(next.skinTone);
                  setSkinToneState(next.skinTone);
                  setEmojiSkinTone(next.skinTone);
                }}
                className="size-7 rounded-md text-base hover:bg-accent"
              >
                {variation?.emoji ?? '✋'}
              </button>
            );
          }}
        </FrimousseEmojiPicker.SkinTone>
      </div>
      <FrimousseEmojiPicker.Viewport className="relative flex-1 outline-none">
        <FrimousseEmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </FrimousseEmojiPicker.Loading>
        <FrimousseEmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No emoji found
        </FrimousseEmojiPicker.Empty>
        <FrimousseEmojiPicker.List
          className="select-none pb-1.5"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                {...props}
                className="bg-popover px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className="scroll-my-1.5 px-1.5">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                {...props}
                className="flex size-8 items-center justify-center rounded-md text-lg data-[active=true]:bg-accent"
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </FrimousseEmojiPicker.Viewport>
    </FrimousseEmojiPicker.Root>
  );
}
