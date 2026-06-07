import React from 'react';
import { Minus, Square, X, Moon, Sun } from 'lucide-react';
import { isMac } from '../../lib/platform';
import { useTheme } from '../../hooks/useTheme';
import { cn } from '../../lib/utils';

/**
 * Custom frameless-window titlebar for Windows / Linux.
 *
 * The desktop main process runs with `frame: false` on non-mac platforms so
 * we draw the whole bar here. The bar itself is `-webkit-app-region: drag`
 * via the `titlebar-drag` utility; the interactive controls (theme toggle,
 * window buttons) re-enable input with `titlebar-no-drag`.
 *
 * On macOS the OS traffic-light buttons are still native (`hiddenInset`),
 * so we render a minimal drag region in `MacTitlebarDrag` and skip this
 * component.
 */
export function AppTitlebar() {
  const { theme, toggle } = useTheme();

  if (isMac) return null;

  const handleMin = () => window.desktop?.window?.minimize();
  const handleMax = () => window.desktop?.window?.maximize();
  const handleClose = () => window.desktop?.window?.close();

  return (
    <div className="titlebar-drag relative flex items-center h-8 shrink-0 bg-background/65 backdrop-blur-xl text-foreground select-none border-b border-border/60">
      <div className="flex-1 flex items-center pl-3 gap-2 overflow-hidden">
        <img
          src="/assets/app.svg"
          alt=""
          width={16}
          height={16}
          aria-hidden
          draggable={false}
          // The packaged SVG ships as a light bg / dark fill (reads in light
          // mode). In dark mode we invert the rendered pixels so the same
          // asset flips to dark bg / light fill. The filter transition
          // matches the 450ms easeInOutCubic curve the rest of the theme
          // crossfade uses (see index.css .theme-switching).
          style={{ transition: 'filter 450ms cubic-bezier(0.65, 0, 0.35, 1)' }}
          className="shrink-0 dark:invert"
        />
        <span className="text-[12px] font-semibold tracking-tight text-foreground truncate">
          Chamber
        </span>
      </div>

      <div className="titlebar-no-drag flex items-center h-full">
        <ThemeToggleButton theme={theme} onToggle={toggle} />
        <button
          type="button"
          aria-label="Minimize"
          onClick={handleMin}
          className="h-full w-11 inline-flex items-center justify-center text-foreground/70 hover:bg-hover hover:text-foreground transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          onClick={handleMax}
          className="h-full w-11 inline-flex items-center justify-center text-foreground/70 hover:bg-hover hover:text-foreground transition-colors"
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          className="h-full w-11 inline-flex items-center justify-center text-foreground/70 hover:bg-red-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

interface ThemeToggleButtonProps {
  theme: 'light' | 'dark';
  onToggle: () => void;
}

function ThemeToggleButton({ theme, onToggle }: ThemeToggleButtonProps) {
  const isDark = theme === 'dark';
  // Easing + duration mirror the document theme crossfade in index.css
  // (.theme-switching => 450ms easeInOutCubic) so the knob, track, and the
  // rest of the app all settle together. The curve is the cubic-bezier
  // equivalent of the canvas `easeInOut` (ambientScene.ts) so the titlebar
  // and the WebGL background advance in perfect lockstep. The toggle is
  // pure monochrome -- track + knob invert when you flip themes so the
  // switch reads as the same color motion as the surface behind it.
  const easing = 'cubic-bezier(0.455, 0.03, 0.515, 0.955)';
  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      onClick={onToggle}
      style={{ transition: `background-color 650ms ${easing}, border-color 650ms ${easing}` }}
      className={cn(
        'relative h-6 w-11 mx-2 rounded-full border inline-flex items-center px-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // Light mode keeps a solid black track with a white knob. Dark mode
        // uses a subtle translucent track so the switch reads as a quiet
        // surface control instead of a glaring white pill in the titlebar;
        // the crisp white knob is the only bright element.
        isDark ? 'border-white/15 bg-white/10' : 'border-foreground/30 bg-foreground/85',
      )}
    >
      {/* Track icons -- the inactive one is dim. Color is the inverse of the
       * track (background) so they stay legible on the bar. */}
      <Sun
        size={11}
        style={{ transition: `opacity 650ms ${easing}` }}
        className={cn(
          'absolute left-1 text-background',
          isDark ? 'opacity-30' : 'opacity-90',
        )}
        aria-hidden
      />
      <Moon
        size={11}
        style={{ transition: `opacity 650ms ${easing}` }}
        className={cn(
          'absolute right-1 text-background',
          isDark ? 'opacity-90' : 'opacity-30',
        )}
        aria-hidden
      />
      {/* Sliding knob with cross-fading icon. */}
      <span
        style={{ transition: `transform 650ms ${easing}, background-color 650ms ${easing}` }}
        className={cn(
          'relative z-10 inline-flex items-center justify-center h-5 w-5 rounded-full shadow-sm',
          // White knob in both themes; in dark the track is subtle so the
          // knob carries the contrast (foreground is white in dark mode).
          isDark ? 'bg-foreground' : 'bg-background',
          isDark ? 'translate-x-5' : 'translate-x-0',
        )}
      >
        <Sun
          size={11}
          style={{ transition: `opacity 650ms ${easing}, transform 650ms ${easing}` }}
          className={cn(
            // Knob is white in both themes, so the knob icon must stay dark.
            'absolute',
            isDark ? 'text-background' : 'text-foreground',
            isDark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100',
          )}
          aria-hidden
        />
        <Moon
          size={11}
          style={{ transition: `opacity 650ms ${easing}, transform 650ms ${easing}` }}
          className={cn(
            'absolute',
            isDark ? 'text-background' : 'text-foreground',
            isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50',
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}
