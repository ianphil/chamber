import { useEffect, useRef, useState } from 'react';
import type { MindContext } from '@chamber/shared/types';
import type { AgentProfileSummary } from '../../lib/store/state';
import { agentColor } from '../chat/agentColors';

// ---------------------------------------------------------------------------
// TypingIndicator — shows who is currently speaking/thinking
// ---------------------------------------------------------------------------

export function TypingIndicator({ speaker, minds, orchestrationMode, profileByMindId }: {
  speaker: { mindId: string; mindName: string; phase: 'speaking' | 'moderating' | 'synthesizing' };
  minds: MindContext[];
  orchestrationMode?: string;
  profileByMindId: Record<string, AgentProfileSummary>;
}) {
  const color = agentColor(minds, speaker.mindId, profileByMindId);
  const phaseText = speaker.phase === 'moderating'
    ? (orchestrationMode === 'magentic' ? 'is planning…' : 'is deciding who speaks next…')
    : speaker.phase === 'synthesizing'
      ? 'is synthesizing the discussion…'
      : 'is speaking…';

  // Elapsed timer — updates every second
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [speaker.mindId, speaker.phase]);

  const elapsedText = elapsed >= 5
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : '';

  return (
    <div className="flex gap-3">
      {/* Spacer matching avatar width */}
      <div className="w-10 shrink-0" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full animate-bounce" style={{ backgroundColor: color, animationDelay: '300ms' }} />
        </div>
        <span className="text-xs">
          <span className="font-medium" style={{ color }}>{speaker.mindName}</span> {phaseText}
          {elapsedText && <span className="text-foreground/50 ml-1.5">{elapsedText}</span>}
        </span>
      </div>
    </div>
  );
}
