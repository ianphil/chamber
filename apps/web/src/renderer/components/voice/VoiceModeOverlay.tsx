import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Loader2, Mic, MicOff, TriangleAlert, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';

interface Props {
  status: VoiceConversationStatus;
  partialText: string;
  error: string | null;
  /** Mind name shown as the conversation partner, when known. */
  mindName?: string;
  onClose: () => void;
}

interface StatusVisual {
  label: string;
  icon: typeof Mic;
  orbClass: string;
  iconClass: string;
}

function statusVisual(status: VoiceConversationStatus): StatusVisual {
  switch (status) {
    case 'listening':
      return { label: 'Listening', icon: Mic, orbClass: 'bg-genesis/15 ring-genesis/40 voice-orb-breathe', iconClass: 'text-genesis' };
    case 'thinking':
      return { label: 'Thinking', icon: Loader2, orbClass: 'bg-muted ring-border', iconClass: 'text-muted-foreground animate-spin' };
    case 'speaking':
      return { label: 'Speaking', icon: AudioLines, orbClass: 'bg-primary/15 ring-primary/40 animate-pulse', iconClass: 'text-primary' };
    case 'error':
      return { label: 'Voice error', icon: TriangleAlert, orbClass: 'bg-destructive/15 ring-destructive/40', iconClass: 'text-destructive' };
    default:
      return { label: 'Connecting', icon: Loader2, orbClass: 'bg-muted ring-border', iconClass: 'text-muted-foreground animate-spin' };
  }
}

const CLOSE_BUTTON_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Full-surface overlay for a hands-free voice conversation. Purely
 * presentational: it reflects the {@link useVoiceConversation} status and live
 * partial transcript, and exposes a single close affordance. The owning
 * controller drives state and tears the session down on close.
 *
 * Behaves as a real modal: focus moves to the close control on open, Tab is
 * trapped within the dialog, Escape dismisses it, and focus is restored to the
 * previously focused element on unmount.
 */
export function VoiceModeOverlay({ status, partialText, error, mindName, onClose }: Props) {
  const visual = statusVisual(status);
  const Icon = visual.icon;
  const micPaused = status === 'thinking' || status === 'speaking';

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm"
    >
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="Close voice mode"
        onClick={onClose}
        className={cn(
          'absolute right-4 top-4 h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center',
          CLOSE_BUTTON_RING,
        )}
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className={cn(
          'flex h-40 w-40 items-center justify-center rounded-full ring-4 transition-colors',
          visual.orbClass,
        )}
      >
        <Icon className={cn('h-16 w-16', visual.iconClass)} />
      </div>

      <p className="mt-8 text-lg font-medium text-foreground" aria-live="polite">
        {visual.label}
      </p>
      {mindName ? (
        <p className="mt-1 text-sm text-muted-foreground">with {mindName}</p>
      ) : null}

      {status === 'error' && error ? (
        <p role="alert" className="mt-4 max-w-md px-6 text-center text-sm text-destructive">{error}</p>
      ) : (
        <p className="mt-4 min-h-[1.5rem] max-w-md px-6 text-center text-sm text-muted-foreground">
          {partialText}
        </p>
      )}

      {micPaused ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MicOff className="h-3.5 w-3.5" />
          Mic paused while the assistant responds
        </p>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className={cn(
          'mt-10 rounded-full bg-muted px-6 py-2 text-sm font-medium text-foreground hover:bg-accent',
          CLOSE_BUTTON_RING,
        )}
      >
        End conversation
      </button>
    </div>,
    document.body,
  );
}
