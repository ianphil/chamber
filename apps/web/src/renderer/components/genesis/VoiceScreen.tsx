import { useEffect, useMemo, useRef, useState } from 'react';
import { TypeWriter } from './TypeWriter';
import { cn } from '../../lib/utils';
import type { GenesisMindTemplate } from '@chamber/shared/types';

interface Props {
  templates: GenesisMindTemplate[];
  templateError: string | null;
  onSelect: (voice: string, description: string) => void;
  onSelectTemplate: (template: GenesisMindTemplate) => void;
  /** Render inside the center pane instead of as a fixed full-screen overlay. */
  embedded?: boolean;
}

const CUSTOM_KEY = 'custom';
type CustomStage = 'editing' | 'preparing' | 'review';

export function VoiceScreen({ templates, templateError, onSelect, onSelectTemplate, embedded = false }: Props) {
  const [showPicker, setShowPicker] = useState(embedded);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [customName, setCustomName] = useState('');
  const [customBackstory, setCustomBackstory] = useState('');
  const [customStage, setCustomStage] = useState<CustomStage>('editing');
  const [customBrief, setCustomBrief] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return templates;

    return templates.filter((template) => {
      const source = templateSourceLabel(template).toLowerCase();
      return [
        template.displayName,
        template.role,
        template.description,
        template.voice,
        source,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [searchQuery, templates]);

  const selectedTemplate = useMemo(() => {
    if (selectedKey === CUSTOM_KEY) return null;

    const explicitTemplate = selectedKey
      ? templates.find((template) => templateKey(template) === selectedKey)
      : null;
    return explicitTemplate ?? filteredTemplates[0] ?? null;
  }, [filteredTemplates, selectedKey, templates]);

  const activeKey = selectedKey === CUSTOM_KEY
    ? CUSTOM_KEY
    : selectedTemplate
      ? templateKey(selectedTemplate)
      : null;

  useEffect(() => {
    if (activeKey !== CUSTOM_KEY) return;
    const t = setTimeout(() => nameRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [activeKey]);

  const handleTemplateConfirm = (template: GenesisMindTemplate) => {
    const key = templateKey(template);
    setSelectedKey(key);
    setConfirmedKey(key);
    setTimeout(() => onSelectTemplate(template), 400);
  };

  const handleCustomSubmit = async () => {
    const name = customName.trim();
    if (!name) return;

    setCustomStage('preparing');
    try {
      await window.electronAPI.genesis.getDefaultPath();
      setTimeout(() => {
        setCustomBrief(buildCustomDescription(name, customBackstory));
        setCustomStage('review');
      }, 500);
    } catch {
      setCustomBrief(buildFallbackCustomDescription(name, customBackstory));
      setCustomStage('review');
    }
  };

  const handleCustomContinue = () => {
    const name = customName.trim();
    const description = customBrief.trim();
    if (!name || !description) return;
    onSelect(name, description);
  };

  return (
    <div className={cn('flex min-h-0 flex-col bg-background px-5 py-8 sm:px-8', embedded ? 'relative h-full w-full' : 'fixed inset-0 z-50')}>
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6">
        {!embedded && (
          <div className="mx-auto max-w-2xl text-center">
            <TypeWriter
              text="I'm here. But I don't know who I am yet. Choose a voice..."
              speed={35}
              className="text-xl font-medium text-foreground"
              onComplete={() => setTimeout(() => setShowPicker(true), 500)}
            />
          </div>
        )}

        {showPicker && (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 animate-in fade-in duration-500 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/60 shadow-2xl shadow-black/20">
              <div className="border-b border-border p-4">
                <div className="mb-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Marketplace
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">Browse minds</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search and select a mind to preview, then load it.
                  </p>
                </div>
                <label className="sr-only" htmlFor="voice-search">Search voices</label>
                <input
                  id="voice-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search name, role, source..."
                  className="w-full rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {templateError ? (
                  <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
                    {templateError}
                  </div>
                ) : null}

                {!templateError && templates.length === 0 ? (
                  <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                    Loading predefined Genesis minds...
                  </div>
                ) : null}

                {!templateError && templates.length > 0 && filteredTemplates.length === 0 ? (
                  <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                    No voices match "{searchQuery.trim()}".
                  </div>
                ) : null}

                <div className="space-y-2">
                  {filteredTemplates.map((template, i) => {
                    const key = templateKey(template);
                    const isActive = activeKey === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          setSelectedKey(key);
                          setConfirmedKey(null);
                        }}
                        style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
                        className={cn(
                          'w-full rounded-xl border p-3 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-1',
                          isActive
                            ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
                            : 'border-transparent hover:border-border hover:bg-accent/70',
                          confirmedKey && confirmedKey !== key ? 'opacity-40' : null,
                        )}
                      >
                        <span className="block text-sm font-semibold text-foreground">{template.displayName}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{template.role}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border bg-background/80 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKey(CUSTOM_KEY);
                    setConfirmedKey(null);
                  }}
                  className={cn(
                    'w-full rounded-xl border p-3 text-left transition-all duration-200',
                    activeKey === CUSTOM_KEY
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-muted-foreground hover:bg-accent',
                  )}
                >
                  <span className="block text-sm font-semibold text-foreground">Someone else...</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Describe a role, character, or energy and I will build it.
                  </span>
                </button>
              </div>
            </aside>

            <section className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-card/40 p-6 shadow-2xl shadow-black/20 sm:p-8">
              {activeKey === CUSTOM_KEY ? (
                <CustomVoicePane
                  customName={customName}
                  customBackstory={customBackstory}
                  customStage={customStage}
                  customBrief={customBrief}
                  nameRef={nameRef}
                  onNameChange={(value) => {
                    setCustomName(value);
                    setCustomStage('editing');
                  }}
                  onBackstoryChange={(value) => {
                    setCustomBackstory(value);
                    setCustomStage('editing');
                  }}
                  onBriefChange={setCustomBrief}
                  onSubmit={handleCustomSubmit}
                  onContinue={handleCustomContinue}
                />
              ) : selectedTemplate ? (
                <TemplateDetailPane
                  template={selectedTemplate}
                  confirmed={confirmedKey === templateKey(selectedTemplate)}
                  onConfirm={() => handleTemplateConfirm(selectedTemplate)}
                />
              ) : (
                <EmptyDetailPane hasError={Boolean(templateError)} />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

interface TemplateDetailPaneProps {
  template: GenesisMindTemplate;
  confirmed: boolean;
  onConfirm: () => void;
}

function TemplateDetailPane({ template, confirmed, onConfirm }: TemplateDetailPaneProps) {
  return (
    <div className="flex min-h-full flex-col justify-between gap-8">
      <div className="space-y-6">
        <div>
          <h3 className="text-3xl font-semibold tracking-tight text-foreground">{template.displayName}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{template.role}</p>
        </div>

        <div className="rounded-2xl border border-border bg-background/50 p-5">
          <p className="text-sm leading-6 text-foreground/90">{template.description}</p>
        </div>

        {(template.skills?.length || template.tools?.length) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {template.skills?.length ? (
              <CapabilityList label="Pre-configured skills" items={template.skills} />
            ) : null}
            {template.tools?.length ? (
              <CapabilityList label="Pre-configured tools" items={template.tools} />
            ) : null}
          </div>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/40 p-4">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Source</dt>
            <dd className="mt-1 font-medium text-foreground">{templateSourceLabel(template)}</dd>
          </div>
          <div className="rounded-xl border border-border bg-background/40 p-4">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Version</dt>
            <dd className="mt-1 font-medium text-foreground">{template.templateVersion}</dd>
          </div>
        </dl>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-medium text-foreground">Voice direction</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{template.voice}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmed}
        className="self-start rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-60"
      >
        {confirmed ? 'Waking this voice...' : 'Choose this voice'}
      </button>
    </div>
  );
}

interface CapabilityListProps {
  label: string;
  items: string[];
}

function CapabilityList({ label, items }: CapabilityListProps) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-medium text-foreground/90"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CustomVoicePaneProps {
  customName: string;
  customBackstory: string;
  customStage: CustomStage;
  customBrief: string;
  nameRef: React.RefObject<HTMLInputElement | null>;
  onNameChange: (value: string) => void;
  onBackstoryChange: (value: string) => void;
  onBriefChange: (value: string) => void;
  onSubmit: () => void;
  onContinue: () => void;
}

function CustomVoicePane({
  customName,
  customBackstory,
  customStage,
  customBrief,
  nameRef,
  onNameChange,
  onBackstoryChange,
  onBriefChange,
  onSubmit,
  onContinue,
}: CustomVoicePaneProps) {
  const hasName = Boolean(customName.trim());
  const isPreparing = customStage === 'preparing';
  const isReviewing = customStage === 'review';

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-between gap-8">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Custom research
          </p>
          <h3 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Someone else...</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Give Chamber a role, person, archetype, or vibe -- a researcher, a personal assistant, a coding
            partner, a specialist, or a specific character. Genesis researches the communication style, values,
            pressure patterns, and signature energy before continuing.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-border bg-background/50 p-5">
          <label className="block text-sm font-medium text-foreground" htmlFor="custom-voice-name">
            Who should this feel like?
          </label>
          <input
            id="custom-voice-name"
            ref={nameRef}
            type="text"
            value={customName}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="e.g. Researcher, personal assistant, coding partner, specialist..."
            className="w-full rounded-xl border border-border bg-transparent px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary"
          />

          <label className="block text-sm font-medium text-foreground" htmlFor="custom-voice-backstory">
            Optional guidance
          </label>
          <textarea
            id="custom-voice-backstory"
            value={customBackstory}
            onChange={(event) => onBackstoryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onSubmit();
            }}
            placeholder="Era, source material, boundaries, or the specific energy you want..."
            rows={4}
            className="w-full resize-none rounded-xl border border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary"
          />
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-medium text-foreground">
            {isPreparing ? 'Preparing the research brief...' : isReviewing ? 'Research brief ready' : 'Research-first creation'}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {isPreparing
              ? 'Genesis is turning your notes into the voice research instructions it will use during creation.'
              : isReviewing
                ? 'Refine this brief before choosing a purpose. The live research still happens during Genesis boot.'
                : 'The next step prepares a research brief you can review before choosing the mind purpose.'}
          </p>
        </div>

        {isReviewing ? (
          <div className="space-y-3 rounded-2xl border border-border bg-background/50 p-5 animate-in fade-in duration-300">
            <label className="block text-sm font-medium text-foreground" htmlFor="custom-voice-brief">
              Research brief
            </label>
            <textarea
              id="custom-voice-brief"
              value={customBrief}
              onChange={(event) => onBriefChange(event.target.value)}
              rows={6}
              className="w-full resize-none rounded-xl border border-border bg-transparent px-4 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={isReviewing ? onContinue : onSubmit}
          disabled={!hasName || isPreparing || (isReviewing && !customBrief.trim())}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {isPreparing ? 'Preparing...' : isReviewing ? 'Continue to purpose' : 'Research this voice'}
        </button>
        {isReviewing ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!hasName}
            className="rounded-xl border border-border px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Rebuild brief
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyDetailPane({ hasError }: { hasError: boolean }) {
  return (
    <div className="flex min-h-full items-center justify-center text-center">
      <p className="max-w-sm text-sm text-muted-foreground">
        {hasError
          ? 'Template voices are unavailable right now. You can still choose Someone else and describe a custom voice.'
          : 'Genesis is loading available voices.'}
      </p>
    </div>
  );
}

function templateKey(template: GenesisMindTemplate): string {
  return `${template.source.marketplaceId ?? `${template.source.owner}/${template.source.repo}`}:${template.id}`;
}

function templateSourceLabel(template: GenesisMindTemplate): string {
  return template.source.marketplaceId ?? `${template.source.owner}/${template.source.repo}`;
}

function buildCustomDescription(name: string, backstoryValue: string): string {
  const backstory = backstoryValue.trim();
  return backstory
    ? `Role/voice: "${name}" -- ${backstory}. Research this role, character, or persona -- their communication style, catchphrases, values, how they handle pressure. Capture the energy.`
    : `Role/voice: "${name}". Research this role, character, or persona -- their communication style, catchphrases, values, how they handle pressure. Capture the energy.`;
}

function buildFallbackCustomDescription(name: string, backstoryValue: string): string {
  const backstory = backstoryValue.trim();
  return backstory ? `Voice energy: ${name} -- ${backstory}` : `Voice energy: ${name}`;
}
