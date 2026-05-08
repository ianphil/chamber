import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@chamber/shared/types';
import { cn } from '../../lib/utils';
import {
  deriveAvatarState,
  getLatestAssistantText,
  getSpeechBubbleText,
  stripMarkdownForSpeech,
  takeSpeakableText,
  type AvatarPanelState,
} from './AgentAvatarPanel.logic';
import { createTalkingHeadAvatar, type TalkingHeadAvatarController } from './talkingHeadAvatar';

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  agentName: string;
  connected: boolean;
  captionsVisible?: boolean;
  layout?: 'side' | 'stage';
  stateOverride?: AvatarPanelState;
}

type LoadState = 'loading' | 'ready' | 'fallback';

export function AgentAvatarPanel({
  messages,
  isStreaming,
  agentName,
  connected,
  captionsVisible = true,
  layout = 'side',
  stateOverride,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TalkingHeadAvatarController | null>(null);
  const lastSpokenRef = useRef<{ messageId: string | null; length: number }>({ messageId: null, length: 0 });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadProgress, setLoadProgress] = useState(0);
  const avatarState = useMemo(
    () => stateOverride ?? (connected ? deriveAvatarState(messages, isStreaming) : 'idle'),
    [connected, isStreaming, messages, stateOverride],
  );
  const speechBubble = captionsVisible && avatarState === 'speaking' ? getSpeechBubbleText(messages) : null;

  useEffect(() => {
    let disposed = false;

    async function initAvatar() {
      if (!containerRef.current) return;

      try {
        const controller = await createTalkingHeadAvatar(containerRef.current, setLoadProgress);
        if (disposed) {
          controller.dispose();
          return;
        }
        controllerRef.current = controller;
        setLoadState('ready');
      } catch (error) {
        console.warn('[avatar] Falling back to local orb avatar:', error);
        if (!disposed) setLoadState('fallback');
      }
    }

    void initAvatar();

    return () => {
      disposed = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setState(avatarState);
  }, [avatarState]);

  useEffect(() => {
    if (avatarState !== 'speaking' || !controllerRef.current) return;

    const latestAssistant = getLatestAssistantText(messages);
    if (!latestAssistant) return;

    if (lastSpokenRef.current.messageId !== latestAssistant.messageId) {
      lastSpokenRef.current = { messageId: latestAssistant.messageId, length: 0 };
    }

    const pendingText = latestAssistant.text.slice(lastSpokenRef.current.length);
    const speakable = takeSpeakableText(pendingText);
    if (!speakable) return;

    lastSpokenRef.current.length += speakable.consumed;
    const speechText = stripMarkdownForSpeech(speakable.text);
    controllerRef.current.speakText(speechText);
  }, [avatarState, messages]);

  const avatarSurface = (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_18%,oklch(0.28_0.04_260),oklch(0.145_0.008_260)_58%)]">
      <div
        ref={containerRef}
        className={cn(
          'chamber-agent-avatar-canvas absolute inset-0',
          loadState !== 'ready' && 'opacity-0',
        )}
      />

      {loadState !== 'ready' && (
        <FallbackAvatar
          state={avatarState}
          agentName={agentName}
          loading={loadState === 'loading'}
          progress={loadProgress}
          large={layout === 'stage'}
        />
      )}

      {speechBubble && (
        <div className={cn(
          'absolute inset-x-4 bottom-4 max-h-32 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-sm leading-relaxed text-white shadow-2xl backdrop-blur',
          layout === 'stage' && 'left-1/2 right-auto w-[min(620px,calc(100%-2rem))] -translate-x-1/2 text-base',
        )}>
          {speechBubble}
        </div>
      )}
    </div>
  );

  if (layout === 'stage') {
    return (
      <section data-testid="agent-avatar-stage" className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="titlebar-drag flex items-center justify-between border-b border-border/70 px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{agentName}</div>
            <div className="text-sm text-muted-foreground">Avatar conversation</div>
          </div>
          <StateBadge state={avatarState} />
        </div>
        {avatarSurface}
      </section>
    );
  }

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card/60 lg:flex">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{agentName}</div>
          <div className="text-xs text-muted-foreground">Local avatar preview</div>
        </div>
        <StateBadge state={avatarState} />
      </div>
      {avatarSurface}
    </aside>
  );
}

function StateBadge({ state }: { state: AvatarPanelState }) {
  const label = {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
  }[state];

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          state === 'idle' && 'bg-emerald-400',
          state === 'listening' && 'bg-sky-400',
          state === 'thinking' && 'animate-pulse bg-amber-400',
          state === 'speaking' && 'chamber-avatar-state-speaking bg-genesis',
        )}
      />
      {label}
    </div>
  );
}

function FallbackAvatar({
  state,
  agentName,
  loading,
  progress,
  large = false,
}: {
  state: AvatarPanelState;
  agentName: string;
  loading: boolean;
  progress: number;
  large?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div
        data-testid="agent-avatar-fallback"
        className={cn(
          'chamber-avatar-orb flex items-center justify-center rounded-full font-semibold text-primary-foreground shadow-2xl',
          large ? 'h-52 w-52 text-7xl' : 'h-28 w-28 text-4xl',
          state,
        )}
      >
        {agentName.charAt(0).toUpperCase()}
      </div>
      <div>
        <div className="text-sm font-medium">
          {loading ? `Loading avatar${progress > 0 ? ` ${progress}%` : ''}` : 'Avatar fallback active'}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {loading ? 'Fetching the local dev TalkingHead model.' : 'Using local orb animation.'}
        </div>
      </div>
    </div>
  );
}
