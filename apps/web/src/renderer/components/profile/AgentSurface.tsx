import { useEffect, useState } from 'react';
import { GraduationCap, LayoutGrid, Wrench } from 'lucide-react';
import type { MindContext, SkillManifest, ToolCatalogEntry } from '@chamber/shared/types';
import { useAppState } from '../../lib/store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface SurfaceItem {
  key: string;
  title: string;
  subtitle?: string;
}

/**
 * AgentSurface — read-only summary of an agent's capability surface for the
 * profile modal, split across Lens / Tools / Skills tabs. Tools and skills
 * load lazily from the bridge; both are defensive so the modal still renders
 * when those bridges are absent.
 */
export function AgentSurface({ mind }: { mind: MindContext }) {
  const { discoveredViews } = useAppState();
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [skills, setSkills] = useState<SkillManifest[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.tools?.list?.()
      .then((list) => { if (!cancelled) setTools((list ?? []).filter((tool) => tool.status === 'installed')); })
      .catch(() => { /* tools registry may be unavailable */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSkills([]);
    void window.electronAPI?.skills?.listForMind?.(mind.mindId)
      .then((list) => { if (!cancelled) setSkills(list ?? []); })
      .catch(() => { /* skills bridge may be unavailable */ });
    return () => { cancelled = true; };
  }, [mind.mindId]);

  const lensItems: SurfaceItem[] = discoveredViews.map((view) => ({
    key: view.id,
    title: view.name,
    subtitle: view.description ?? view.view,
  }));
  const toolItems: SurfaceItem[] = tools.map((tool) => ({
    key: tool.id,
    title: tool.displayName ?? tool.id,
    subtitle: tool.description,
  }));
  const skillItems: SurfaceItem[] = skills.map((skill) => ({
    key: skill.id,
    title: skill.name || skill.id,
    subtitle: skill.description,
  }));

  return (
    <Tabs defaultValue="lens" className="gap-3">
      <TabsList>
        <TabsTrigger value="lens">
          <LayoutGrid size={14} /> Lens
          <TabCount count={lensItems.length} />
        </TabsTrigger>
        <TabsTrigger value="tools">
          <Wrench size={14} /> Tools
          <TabCount count={toolItems.length} />
        </TabsTrigger>
        <TabsTrigger value="skills">
          <GraduationCap size={14} /> Skills
          <TabCount count={skillItems.length} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="lens">
        <SurfaceList items={lensItems} emptyHint="No lens views yet." />
      </TabsContent>
      <TabsContent value="tools">
        <SurfaceList items={toolItems} emptyHint="No tools installed yet." />
      </TabsContent>
      <TabsContent value="skills">
        <SurfaceList items={skillItems} emptyHint="No skills installed yet." />
      </TabsContent>
    </Tabs>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-background/60 px-1.5 text-[11px] tabular-nums text-foreground/55">
      {count}
    </span>
  );
}

function SurfaceList({ items, emptyHint }: { items: SurfaceItem[]; emptyHint: string }) {
  if (items.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card/60 p-4">
        <p className="text-xs text-foreground/55">{emptyHint}</p>
      </section>
    );
  }
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card/60">
      {items.map((item) => (
        <div
          key={item.key}
          className="px-3 py-2 transition-colors hover:bg-accent/50"
        >
          <div className="text-sm font-medium text-foreground">{item.title}</div>
          {item.subtitle ? (
            <p className="text-xs text-foreground/60 line-clamp-2">{item.subtitle}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
