import { useEffect, useMemo, useState } from 'react';
import { Camera, FileText, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { cn } from '../../lib/utils';
import { useAppDispatch, useAppState } from '../../lib/store';
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

const secondaryButtonClass = 'rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-50';
const primaryButtonClass = 'rounded-lg bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-300 disabled:opacity-50 disabled:hover:bg-sky-400';
const iconButtonClass = 'inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white';

export function AgentProfileModal({ mind, open, onOpenChange, onProfileChanged }: AgentProfileModalProps) {
  const dispatch = useAppDispatch();
  const { featureFlags } = useAppState();
  const dreamDaemonFlag = featureFlags.dreamDaemon;
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<AgentProfileFile | null>(null);
  const [avatarSource, setAvatarSource] = useState<AgentProfileAvatarSource | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [togglingDreamDaemon, setTogglingDreamDaemon] = useState(false);

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
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
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
      setError(restartError instanceof Error ? restartError.message : String(restartError));
    } finally {
      setRestarting(false);
    }
  };

  const handleToggleDreamDaemon = async () => {
    if (!profile || togglingDreamDaemon) return;
    const next = !profile.dreamDaemonEnabled;
    setTogglingDreamDaemon(true);
    setError(null);
    try {
      await window.electronAPI.mind.setDreamDaemon(profile.mindId, next);
      const updatedProfile = await window.electronAPI.mindProfile.get(profile.mindId);
      setProfile(updatedProfile);
      onProfileChanged?.(updatedProfile);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setTogglingDreamDaemon(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden bg-slate-950 p-0 text-slate-100">
          <div className="flex min-h-[620px] flex-col">
            <DialogHeader className="border-b border-border px-6 py-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <DialogTitle>Agent profile</DialogTitle>
                  <DialogDescription>
                    Edit local profile assets for this agent. Share and publish are tracked separately.
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
              {loading ? <p className="text-sm text-muted-foreground">Loading profile...</p> : null}
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
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ProfileFact label="Display name" value={profile.displayName} />
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

                  {/*
                    Dream-daemon opt-in toggle. Mirrors the genesis-time
                    switch in RoleScreen so an existing mind can be opted
                    in/out post-creation. Flipping it triggers a mind reload
                    (see MindManager.enableDreamDaemon / disableDreamDaemon)
                    so the new opt-in state takes effect immediately —
                    composer reads the gate, DailyLogWriter migrates legacy
                    `log.md` if needed.
                    Gated behind the app-level `dreamDaemon` feature flag:
                    when off, the entire row is hidden. MindProfileService
                    also forces `dreamDaemonEnabled: false` server-side in
                    the same case, so the data and UI agree.
                  */}
                  {dreamDaemonFlag && (
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-slate-900/40 px-4 py-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">Enable dream daemon</div>
                        <div className="text-xs text-muted-foreground">
                          Background memory consolidation. When enabled, this agent's chat history is structured and summarized over time.
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={profile.dreamDaemonEnabled}
                        aria-label="Enable dream daemon"
                        disabled={togglingDreamDaemon}
                        onClick={handleToggleDreamDaemon}
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          'disabled:opacity-50 disabled:cursor-not-allowed',
                          profile.dreamDaemonEnabled ? 'bg-sky-500' : 'bg-slate-700',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition',
                            profile.dreamDaemonEnabled ? 'translate-x-5' : 'translate-x-0',
                          )}
                        />
                      </button>
                    </div>
                  )}
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

function AvatarPreview({ profile }: { profile: AgentProfile }) {
  if (profile.avatarDataUrl) {
    return <img src={profile.avatarDataUrl} alt="" className="h-24 w-24 rounded-2xl border border-border object-cover" />;
  }
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-primary/15 text-3xl font-bold text-primary">
      {initials(profile.displayName)}
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
      className="min-h-72 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-900"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-muted-foreground" />
          <span className="font-medium text-foreground">{file.label}</span>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300">
          {file.exists ? 'Edit' : 'Create'}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{file.relativePath}</p>
      <pre className="max-h-44 overflow-hidden whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
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
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle>{file?.label ?? 'Profile file'}</DialogTitle>
          <DialogDescription>{file?.relativePath}</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          className="min-h-[200px] w-full flex-1 resize-none rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-primary"
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
      <DialogContent className="max-w-3xl bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle>Crop avatar</DialogTitle>
          <DialogDescription>Position the square crop, then save a normalized 512x512 avatar.</DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
        {source && crop ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex min-h-96 items-center justify-center rounded-2xl border border-slate-800 bg-black p-3">
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
      className="relative mx-auto overflow-hidden rounded-2xl border border-slate-700 bg-black"
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
