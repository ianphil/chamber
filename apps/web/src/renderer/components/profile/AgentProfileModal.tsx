import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { Camera, Check, FileText, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import { useAppDispatch } from '../../lib/store';
import { AgentSurface } from './AgentSurface';
import { Skeleton } from '../ui/skeleton';
import { AGENT_COLORS } from '../chat/agentColors';
import type {
  AgentProfile,
  AgentProfileAvatarCrop,
  AgentProfileAvatarSource,
  AgentProfileFile,
  MindContext,
} from '@chamber/shared/types';

interface AgentProfileModalProps {
  mind: MindContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileChanged?: (profile: AgentProfile) => void;
}

const secondaryButtonClass = 'rounded-lg border border-border bg-card/80 px-4 py-2 text-sm text-foreground transition-colors hover:border-border hover:bg-secondary hover:text-white disabled:opacity-50';
const primaryButtonClass = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary';
const iconButtonClass = 'inline-flex items-center justify-center rounded-md border border-border bg-card/80 px-2 py-1 text-xs text-foreground transition-colors hover:border-border hover:bg-secondary hover:text-white';

export function AgentProfileModal({ mind, open, onOpenChange, onProfileChanged }: AgentProfileModalProps) {
  const dispatch = useAppDispatch();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<AgentProfileFile | null>(null);
  const [avatarSource, setAvatarSource] = useState<AgentProfileAvatarSource | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!open || !mind) {
      setProfile(null);
      setError(null);
      setEditingFile(null);
      setAvatarSource(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    window.electronAPI.mindProfile.get(mind.mindId)
      .then((loadedProfile) => {
        if (!cancelled) setProfile(loadedProfile);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mind, open]);

  const handlePickAvatar = async () => {
    const result = await window.electronAPI.mindProfile.pickAvatarImage();
    if (!result.success) {
      setError(result.error);
      return;
    }
    setAvatarSource(result.source);
  };

  const handleRemoveAvatar = async () => {
    if (!profile) return;
    const result = await window.electronAPI.mindProfile.removeAvatar(profile.mindId);
    if (result.success) {
      setProfile(result.profile);
      onProfileChanged?.(result.profile);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const handleSetAccentColor = async (color: string | null) => {
    if (!profile) return;
    const result = await window.electronAPI.mindProfile.setAccentColor(profile.mindId, color);
    if (result.success) {
      setProfile(result.profile);
      onProfileChanged?.(result.profile);
      dispatch({
        type: 'SET_AGENT_PROFILE_SUMMARY',
        payload: {
          mindId: result.profile.mindId,
          displayName: result.profile.displayName,
          avatarDataUrl: result.profile.avatarDataUrl,
          accentColor: result.profile.accentColor,
        },
      });
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const handleRestart = async () => {
    if (!profile) return;
    setRestarting(true);
    setError(null);
    try {
      await window.electronAPI.mindProfile.restart(profile.mindId);
      const minds = await window.electronAPI.mind.list();
      dispatch({ type: 'SET_MINDS', payload: minds });
      const updatedProfile = await window.electronAPI.mindProfile.get(profile.mindId);
      setProfile(updatedProfile);
      onProfileChanged?.(updatedProfile);
    } catch (restartError) {
      setError(getErrorMessage(restartError));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="surface-panel flex max-h-[88vh] min-h-[min(620px,88vh)] w-full max-w-5xl flex-col overflow-hidden bg-background p-0 text-foreground">
          <div className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="border-b border-border px-6 py-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <DialogTitle>Agent</DialogTitle>
                  <DialogDescription>
                    This agent's profile, identity files, and capability surface. Share and publish are tracked separately.
                  </DialogDescription>
                </div>
                {profile?.needsRestart ? (
                  <button
                    type="button"
                    onClick={handleRestart}
                    disabled={restarting}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {restarting ? 'Restarting...' : 'Restart agent to apply'}
                  </button>
                ) : null}
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {loading ? <AgentProfileSkeleton /> : null}
              {error ? <div role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}

              {profile ? (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-[120px_minmax(0,1fr)]">
                    <div className="flex flex-col items-center gap-3">
                      <AvatarPreview profile={profile} />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handlePickAvatar}
                          className={iconButtonClass}
                        >
                          <Camera size={14} />
                          <span className="sr-only">Upload avatar</span>
                        </button>
                        {profile.avatarDataUrl ? (
                          <button
                            type="button"
                            onClick={handleRemoveAvatar}
                            className={cn(iconButtonClass, 'hover:border-red-500/70 hover:bg-red-500/10 hover:text-red-200')}
                          >
                            <Trash2 size={14} />
                            <span className="sr-only">Remove avatar</span>
                          </button>
                        ) : null}
                      </div>
                      <AccentColorPicker selected={profile.accentColor} onSelect={handleSetAccentColor} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ProfileFact label="Display name" value={profile.displayName} />
                      <ProfileFact label="Model" value={mind?.selectedModel ?? '—'} />
                      <ProfileFact label="Folder" value={profile.folderName} />
                      <ProfileFact label="Path" value={profile.mindPath} className="sm:col-span-2" />
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <ProfileFileCard file={profile.soul} onOpen={() => setEditingFile(profile.soul)} />
                    {profile.agentFiles.map((agentFile) => (
                      <ProfileFileCard
                        key={agentFile.relativePath}
                        file={agentFile}
                        onOpen={() => setEditingFile(agentFile)}
                      />
                    ))}
                  </div>

                  {mind ? <AgentSurface mind={mind} /> : null}
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={secondaryButtonClass}
              >
                Close
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ProfileMarkdownEditor
        file={editingFile}
        mindId={profile?.mindId ?? null}
        onClose={() => setEditingFile(null)}
        onSaved={(updatedProfile) => {
          setProfile(updatedProfile);
          onProfileChanged?.(updatedProfile);
          setEditingFile(null);
        }}
      />

      <AvatarCropModal
        source={avatarSource}
        mindId={profile?.mindId ?? null}
        onClose={() => setAvatarSource(null)}
        onSaved={(updatedProfile) => {
          setProfile(updatedProfile);
          onProfileChanged?.(updatedProfile);
          setAvatarSource(null);
        }}
      />
    </>
  );
}

// Mirrors the loaded profile layout (avatar + facts grid + file cards) so the
// modal body keeps a stable height while the profile loads.
function AgentProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[120px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-2xl" />
          <Skeleton className="h-7 w-16" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16 sm:col-span-2" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

function AvatarPreview({ profile }: { profile: AgentProfile }) {
  if (profile.avatarDataUrl) {
    return <img src={profile.avatarDataUrl} alt="" className="h-24 w-24 rounded-2xl border border-border object-cover" />;
  }
  const accent = profile.accentColor;
  return (
    <div
      className={cn(
        'flex h-24 w-24 items-center justify-center rounded-2xl border border-border text-3xl font-bold',
        !accent && 'bg-primary/15 text-primary',
      )}
      style={accent ? { backgroundColor: `${accent}26`, color: accent } : undefined}
    >
      {initials(profile.displayName)}
    </div>
  );
}

// Preset accent swatches plus a reset-to-default control. The chosen color
// drives the agent's pill, avatar fallback, and message accents everywhere.
function AccentColorPicker({ selected, onSelect }: { selected: string | null; onSelect: (color: string | null) => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {AGENT_COLORS.map((color) => {
          const isActive = selected?.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              onClick={() => onSelect(color)}
              aria-label={`Use ${color} accent color`}
              aria-pressed={isActive}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isActive && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: color }}
            >
              {isActive ? <Check size={12} className="text-white" /> : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Default color
      </button>
    </div>
  );
}

function ProfileFact({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-background/40 p-3', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm text-foreground" title={value}>{value}</p>
    </div>
  );
}

function ProfileFileCard({ file, onOpen }: { file: AgentProfileFile; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="surface-card surface-card-hover min-h-72 rounded-xl border border-border bg-card/60 p-4 text-left text-foreground"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-muted-foreground" />
          <span className="font-medium text-foreground">{file.label}</span>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground/70">
          {file.exists ? 'Edit' : 'Create'}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{file.relativePath}</p>
      <pre className="max-h-44 overflow-hidden whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-5 text-foreground/70">
        {file.content.trim() || 'No local profile file yet.'}
      </pre>
    </button>
  );
}

function ProfileMarkdownEditor({
  file,
  mindId,
  onClose,
  onSaved,
}: {
  file: AgentProfileFile | null;
  mindId: string | null;
  onClose: () => void;
  onSaved: (profile: AgentProfile) => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(file?.content ?? '');
    setError(null);
  }, [file]);

  const dirty = file ? value !== file.content : false;

  const handleSave = async () => {
    if (!file || !mindId) return;
    setSaving(true);
    setError(null);
    const result = await window.electronAPI.mindProfile.saveFile({
      mindId,
      kind: file.kind,
      relativePath: file.relativePath,
      content: value,
      expectedMtimeMs: file.mtimeMs,
    });
    setSaving(false);
    if (result.success) {
      onSaved(result.profile);
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-w-4xl flex-col bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{file?.label ?? 'Profile file'}</DialogTitle>
          <DialogDescription>{file?.relativePath}</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          style={{ height: '60vh', maxHeight: '85vh' }}
          className="w-full min-h-[200px] resize-y rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary"
        />
        <DialogFooter>
          {dirty ? <span className="mr-auto self-center text-xs text-amber-300">Unsaved edits</span> : null}
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className={primaryButtonClass}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AvatarCropModal({
  source,
  mindId,
  onClose,
  onSaved,
}: {
  source: AgentProfileAvatarSource | null;
  mindId: string | null;
  onClose: () => void;
  onSaved: (profile: AgentProfile) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setError(null);
  }, [source]);

  const crop = useMemo(() => {
    if (!source) return null;
    const side = Math.max(1, Math.floor(Math.min(source.width, source.height) / zoom));
    const maxLeft = source.width - side;
    const maxTop = source.height - side;
    return {
      left: Math.round((maxLeft / 2) + (offsetX / 100) * (maxLeft / 2)),
      top: Math.round((maxTop / 2) + (offsetY / 100) * (maxTop / 2)),
      width: side,
      height: side,
    };
  }, [offsetX, offsetY, source, zoom]);

  const handleSave = async () => {
    if (!source || !mindId || !crop) return;
    setSaving(true);
    setError(null);
    const result = await window.electronAPI.mindProfile.saveAvatar({ mindId, sourceId: source.sourceId, crop });
    setSaving(false);
    if (result.success) {
      onSaved(result.profile);
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Crop avatar</DialogTitle>
          <DialogDescription>Position the square crop, then save a normalized 512x512 avatar.</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
        {source && crop ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-h-96 items-center justify-center rounded-2xl border border-border bg-black p-3">
              <CropPreview source={source} crop={crop} size={360} />
            </div>
            <div className="space-y-4">
              <CropPreview source={source} crop={crop} size={112} />
              <RangeControl label="Zoom" value={zoom} min={1} max={3} step={0.05} onChange={setZoom} />
              <RangeControl label="Horizontal" value={offsetX} min={-100} max={100} step={1} onChange={setOffsetX} />
              <RangeControl label="Vertical" value={offsetY} min={-100} max={100} step={1} onChange={setOffsetY} />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={primaryButtonClass}
          >
            {saving ? 'Saving...' : 'Save avatar'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CropPreview({
  source,
  crop,
  size,
}: {
  source: AgentProfileAvatarSource;
  crop: NonNullable<AgentProfileAvatarCrop>;
  size: number;
}) {
  const scale = size / crop.width;

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-2xl border border-border bg-black"
      style={{ width: size, height: size }}
    >
      <img
        src={source.dataUrl}
        alt=""
        className="absolute left-0 top-0 max-w-none"
        style={{
          width: source.width * scale,
          height: source.height * scale,
          transform: `translate(${-crop.left * scale}px, ${-crop.top * scale}px)`,
        }}
      />
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase();
}
