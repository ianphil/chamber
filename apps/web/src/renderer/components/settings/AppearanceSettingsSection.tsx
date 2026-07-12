import { type KeyboardEvent, type ReactNode } from 'react';
import { useDensity, useFontScale, type Density, type FontScale } from '../../hooks/useAppearance';
import { useTheme, type ThemePreference } from '../../hooks/useTheme';
import { cn } from '../../lib/utils';

interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

const THEME_OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const FONT_SCALE_OPTIONS: readonly SegmentOption<FontScale>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const DENSITY_OPTIONS: readonly SegmentOption<Density>[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
}) {
  // Arrow keys move the selection (the WAI-ARIA radio group pattern); focus
  // follows via roving tabindex so the group is a single tab stop.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const currentIndex = options.findIndex((option) => option.value === value);
    const delta = forward ? 1 : -1;
    const next = options[(currentIndex + delta + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[(currentIndex + delta + options.length) % options.length]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="inline-flex rounded-lg border border-border bg-background p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-selected text-foreground font-medium'
                : 'text-foreground/70 hover:bg-hover hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AppearanceRow({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AppearanceSettingsSection() {
  const { theme, setTheme } = useTheme();
  const { fontScale, setFontScale } = useFontScale();
  const { density, setDensity } = useDensity();

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="text-xs text-foreground/60">
          How Chamber looks on this device. Changes apply instantly and are saved locally.
        </p>
      </header>
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <AppearanceRow title="Theme" description="Use a light or dark palette, or follow your operating system.">
          <SegmentedControl<ThemePreference>
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            onChange={setTheme}
          />
        </AppearanceRow>
        <AppearanceRow title="Font size" description="Scale the interface text and spacing.">
          <SegmentedControl<FontScale>
            label="Font size"
            value={fontScale}
            options={FONT_SCALE_OPTIONS}
            onChange={setFontScale}
          />
        </AppearanceRow>
        <AppearanceRow title="Density" description="Comfortable adds breathing room; compact fits more on screen.">
          <SegmentedControl<Density>
            label="Density"
            value={density}
            options={DENSITY_OPTIONS}
            onChange={setDensity}
          />
        </AppearanceRow>
      </div>
    </section>
  );
}
