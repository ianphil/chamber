import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, Check, X, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AgentAvatar } from '../profile/AgentAvatar';
import { agentColor } from '../chat/agentColors';
import type { MindContext } from '@chamber/shared/types';
import type {
  OrchestrationMode,
  GroupChatConfig,
  HandoffConfig,
  MagenticConfig,
  TaskLedgerItem,
} from '@chamber/shared/chatroom-types';
import type { AgentProfileSummary } from '../../lib/store/state';

// ---------------------------------------------------------------------------
// OrchestrationDiagram — a live "collaboration topology" for the active mode.
//
// Each orchestration mode has a distinct shape:
//   concurrent  → fan-out      (one prompt, every agent answers at once)
//   sequential  → pipeline     (a baton-free chain, left to right)
//   group-chat  → hub & spoke  (a moderator picks who speaks next)
//   handoff     → relay        (one holder at a time, the baton slides)
//   magentic    → manager tree (a manager delegates to workers)
//
// The diagram lights up from live state (streamingByMind / activeSpeaker /
// task ledger) so the user watches the collaboration happen in its native
// shape instead of reading it as one flat message list.
// ---------------------------------------------------------------------------

type ActiveSpeaker = {
  mindId: string;
  mindName: string;
  phase: 'speaking' | 'moderating' | 'synthesizing';
} | null;

interface OrchestrationDiagramProps {
  mode: OrchestrationMode;
  minds: MindContext[];
  profileByMindId: Record<string, AgentProfileSummary>;
  streamingByMind: Record<string, boolean>;
  activeSpeaker: ActiveSpeaker;
  disabledMindIds: string[];
  groupChatConfig?: GroupChatConfig | null;
  handoffConfig?: HandoffConfig | null;
  magneticConfig?: MagenticConfig | null;
  taskLedger: TaskLedgerItem[];
}

type NodeState = 'idle' | 'active' | 'done' | 'failed' | 'planning';

function displayName(profile: AgentProfileSummary | undefined, fallback: string): string {
  return profile?.displayName?.trim() || fallback;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A single agent (or hub) node: avatar + name, with a live status ring. */
function Node({
  name,
  color,
  avatarDataUrl,
  state,
  role,
  size = 'md',
  compact,
  baton,
}: {
  name: string;
  color: string;
  avatarDataUrl?: string | null;
  state: NodeState;
  role?: string;
  size?: 'md' | 'lg';
  compact?: boolean;
  baton?: boolean;
}) {
  const dim = size === 'lg' ? 'w-10 h-10' : compact ? 'w-7 h-7' : 'w-9 h-9';
  const lit = state === 'active' || state === 'planning';
  return (
    <div className={cn('flex flex-col items-center gap-1 shrink-0')}>
      <div className="relative">
        {baton && (
          <span
            className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 block w-2.5 h-2.5 rounded-full bg-genesis ring-2 ring-genesis/40 animate-pulse"
            title="Holds the baton"
            aria-hidden
          />
        )}
        <AgentAvatar
          name={name}
          avatarDataUrl={avatarDataUrl}
          className={cn(dim, 'rounded-full flex items-center justify-center text-xs font-semibold')}
          fallbackClassName="text-white"
          fallback={name.charAt(0).toUpperCase()}
          style={{ backgroundColor: color, color: '#fff' }}
        />
        {lit && (
          <span
            className="absolute -inset-1 rounded-full border-2 animate-pulse pointer-events-none"
            style={{ borderColor: color }}
            aria-hidden
          />
        )}
        {state === 'done' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-genesis flex items-center justify-center" aria-hidden>
            <Check size={9} className="text-white" />
          </span>
        )}
        {state === 'failed' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-destructive flex items-center justify-center" aria-hidden>
            <X size={9} className="text-white" />
          </span>
        )}
      </div>
      <span className="text-[10px] leading-tight max-w-[64px] truncate text-foreground/80" title={name}>
        {name}
      </span>
      {role && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 -mt-0.5">{role}</span>
      )}
    </div>
  );
}

/** A neutral, non-agent node (the user's prompt). */
function PromptNode({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="relative">
        <div className="w-9 h-9 rounded-full bg-foreground/10 flex items-center justify-center text-foreground/70">
          <Sparkles size={16} />
        </div>
        {active && (
          <span className="absolute -inset-1 rounded-full border-2 border-foreground/40 animate-pulse pointer-events-none" aria-hidden />
        )}
      </div>
      <span className="text-[10px] leading-tight text-foreground/60">Prompt</span>
    </div>
  );
}

/** Vertical connector with an optional traveling glow (top → bottom). */
function VLine({ active, color, style }: { active: boolean; color?: string; style?: CSSProperties }) {
  return (
    <div className="absolute w-[2px] bg-foreground/15 overflow-hidden" style={style} aria-hidden>
      {active && (
        <div
          className="absolute inset-x-[-1px] h-1/2 chamber-travel-y"
          style={{ background: `linear-gradient(to bottom, transparent, ${color ?? 'currentColor'})` }}
        />
      )}
    </div>
  );
}

/** Horizontal connector for chains, with a centered chevron + traveling glow. */
function HLine({ active, color, compact }: { active: boolean; color: string; compact?: boolean }) {
  return (
    <div className={cn('relative flex items-center mx-0.5', compact ? 'w-8 h-7' : 'flex-1 h-9')} aria-hidden>
      <div className="relative w-full h-[2px] bg-foreground/15 overflow-hidden">
        {active && (
          <div
            className="absolute inset-y-[-2px] w-1/2 chamber-travel-x"
            style={{ background: `linear-gradient(to right, transparent, ${color})` }}
          />
        )}
      </div>
      <ChevronRight size={12} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/30" />
    </div>
  );
}

/**
 * Hub-and-spoke connector skeleton: a center drop from the hub to a horizontal
 * rail, then a drop line to each node below. Positions are derived from equal
 * flex cells so it stays aligned at any width.
 */
function HubConnectors({ count, activeIndex, centerActive, color }: {
  count: number;
  activeIndex: number | null;
  centerActive: boolean;
  color: string;
}) {
  if (count <= 0) return null;
  const inset = 50 / count; // half a cell, as a percentage of the row width
  return (
    <div className="relative h-4 w-full" aria-hidden>
      {/* hub → rail */}
      <VLine active={centerActive} color={color} style={{ left: '50%', top: 0, height: '50%' }} />
      {/* rail */}
      {count > 1 && (
        <div
          className="absolute h-[2px] bg-foreground/15"
          style={{ top: '50%', left: `${inset}%`, right: `${inset}%` }}
        />
      )}
      {/* rail → each node */}
      {Array.from({ length: count }).map((_, i) => (
        <VLine
          key={i}
          active={activeIndex === i}
          color={color}
          style={{ left: `${(i + 0.5) * (100 / count)}%`, top: '50%', height: '50%' }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-mode renderers
// ---------------------------------------------------------------------------

/** Above this many spokes/agents we drop to compact nodes and wrap the row. */
const COMPACT_THRESHOLD = 6;

/**
 * Hub-and-spoke / fan-out layout: a top node (hub or prompt) over a row of
 * agents. For small teams it draws aligned rail connectors; for larger teams
 * it wraps the agents into a grid and shows a single hub drop instead, so the
 * topology stays legible at any headcount.
 */
function Cluster({ top, centerActive, centerColor, nodes, activeIndex }: {
  top: ReactNode;
  centerActive: boolean;
  centerColor: string;
  nodes: DiagramNode[];
  activeIndex: number | null;
}) {
  const count = nodes.length;
  const wrap = count > COMPACT_THRESHOLD;
  return (
    <div className="flex flex-col items-center w-full">
      {top}
      {wrap ? (
        <div className="relative h-3 w-full" aria-hidden>
          <VLine active={centerActive} color={centerColor} style={{ left: '50%', top: 0, height: '100%' }} />
        </div>
      ) : (
        <HubConnectors count={count} activeIndex={activeIndex} centerActive={centerActive} color={centerColor} />
      )}
      {wrap ? (
        <div className="flex flex-wrap items-start justify-center gap-x-3 gap-y-3 w-full">
          {nodes.map((n) => (
            <Node key={n.mindId} {...n.props} compact state={n.state} />
          ))}
        </div>
      ) : (
        <div className="flex items-start w-full">
          {nodes.map((n) => (
            <div key={n.mindId} className="flex-1 flex justify-center min-w-0">
              <Node {...n.props} state={n.state} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Linear chain layout for sequential + handoff. Scrolls horizontally rather
 * than cramming when there are many agents. `activeIndex` lights a node (and
 * the connector leading into it); `batonIndex` marks the handoff holder.
 */
function Chain({ nodes, activeIndex, batonIndex }: {
  nodes: DiagramNode[];
  activeIndex: number;
  batonIndex?: number;
}) {
  const compact = nodes.length > COMPACT_THRESHOLD;
  const row = (
    <div className={cn('flex items-start', compact ? 'min-w-min px-1' : 'w-full justify-center')}>
      {nodes.map((n, i) => (
        <div key={n.mindId} className={cn('flex items-start', !compact && i > 0 && 'flex-1')}>
          {i > 0 && <HLine active={i === activeIndex} color={n.props.color} compact={compact} />}
          <Node
            {...n.props}
            compact={compact}
            state={i === activeIndex ? 'active' : 'idle'}
            baton={batonIndex === i}
          />
        </div>
      ))}
    </div>
  );
  return compact ? <div className="w-full overflow-x-auto">{row}</div> : row;
}

// ---------------------------------------------------------------------------
// Node model
// ---------------------------------------------------------------------------

interface DiagramNode {
  mindId: string;
  streaming: boolean;
  state: NodeState;
  role?: string;
  props: {
    name: string;
    color: string;
    avatarDataUrl?: string | null;
  };
}

// ---------------------------------------------------------------------------
// OrchestrationDiagram
// ---------------------------------------------------------------------------

const MODE_CAPTION: Record<OrchestrationMode, string> = {
  concurrent: 'Every agent answers the same prompt in parallel.',
  sequential: 'Agents respond in turn, each building on the last.',
  'group-chat': 'A moderator decides who speaks next.',
  handoff: 'One agent holds the baton and passes it on.',
  magentic: 'A manager delegates subtasks to the team.',
};

export function OrchestrationDiagram({
  mode,
  minds,
  profileByMindId,
  streamingByMind,
  activeSpeaker,
  disabledMindIds,
  groupChatConfig,
  handoffConfig,
  magneticConfig,
  taskLedger,
}: OrchestrationDiagramProps) {
  if (minds.length === 0) return null;
  const disabledSet = new Set(disabledMindIds);
  // Disabled agents sit out the round, so they drop out of the topology
  // entirely rather than lingering as grayed-out nodes.
  const activeMinds = minds.filter((mind) => !disabledSet.has(mind.mindId));
  if (activeMinds.length === 0) return null;

  const toNode = (mind: MindContext): DiagramNode => {
    const profile = profileByMindId[mind.mindId];
    return {
      mindId: mind.mindId,
      streaming: !!streamingByMind[mind.mindId],
      state: 'idle',
      props: {
        name: displayName(profile, mind.identity.name),
        color: agentColor(minds, mind.mindId, profileByMindId),
        avatarDataUrl: profile?.avatarDataUrl,
      },
    };
  };

  const allNodes = activeMinds.map(toNode);
  const anyStreaming = allNodes.some((n) => n.streaming);
  const activeId = activeSpeaker?.mindId ?? null;

  let body: ReactNode;
  let caption = MODE_CAPTION[mode];

  if (mode === 'concurrent') {
    const nodes = allNodes.map((n) => ({ ...n, state: n.streaming ? ('active' as const) : ('idle' as const) }));
    body = (
      <Cluster
        top={<PromptNode active={anyStreaming} />}
        centerActive={anyStreaming}
        centerColor="currentColor"
        nodes={nodes}
        activeIndex={null}
      />
    );
    if (anyStreaming) caption = 'All agents are responding in parallel.';
  } else if (mode === 'sequential') {
    const activeIndex = allNodes.findIndex((n) => n.mindId === activeId);
    body = <Chain nodes={allNodes} activeIndex={activeIndex} />;
    if (activeIndex >= 0) caption = `${allNodes[activeIndex].props.name} is responding.`;
  } else if (mode === 'group-chat') {
    const moderatorId = groupChatConfig?.moderatorMindId ?? activeMinds[0].mindId;
    const moderatorMind = activeMinds.find((m) => m.mindId === moderatorId) ?? activeMinds[0];
    const hub = toNode(moderatorMind);
    hub.role = 'Moderator';
    const speakers = allNodes.filter((n) => n.mindId !== moderatorMind.mindId);
    const activeIndex = speakers.findIndex((n) => n.mindId === activeId);
    const moderating = activeSpeaker?.phase === 'moderating' || (anyStreaming && activeIndex < 0);
    const nodes = speakers.map((n, i) => ({
      ...n,
      state: i === activeIndex ? ('active' as const) : ('idle' as const),
    }));
    body = (
      <Cluster
        top={<Node {...hub.props} state={moderating ? 'planning' : 'idle'} role={hub.role} size="lg" />}
        centerActive={moderating}
        centerColor={activeIndex >= 0 ? speakers[activeIndex].props.color : hub.props.color}
        nodes={nodes}
        activeIndex={activeIndex >= 0 ? activeIndex : null}
      />
    );
    if (moderating) caption = `${hub.props.name} is choosing the next speaker.`;
    else if (activeIndex >= 0) caption = `${speakers[activeIndex].props.name} has the floor.`;
  } else if (mode === 'handoff') {
    const startId = handoffConfig?.initialMindId ?? activeMinds[0].mindId;
    const holderId = activeId ?? startId;
    const holderIndex = Math.max(0, allNodes.findIndex((n) => n.mindId === holderId));
    const holderStreaming = !!allNodes[holderIndex]?.streaming;
    body = (
      <Chain
        nodes={allNodes}
        activeIndex={holderStreaming ? holderIndex : -1}
        batonIndex={holderIndex}
      />
    );
    const holderName = allNodes[holderIndex]?.props.name ?? '…';
    caption = holderStreaming ? `${holderName} is responding.` : `Baton with ${holderName}.`;
  } else {
    // magentic
    const managerId = magneticConfig?.managerMindId ?? activeMinds[0].mindId;
    const managerMind = activeMinds.find((m) => m.mindId === managerId) ?? activeMinds[0];
    const hub = toNode(managerMind);
    hub.role = 'Manager';
    const workers = allNodes
      .filter((n) => n.mindId !== managerMind.mindId)
      .map((n) => ({ ...n, state: workerState(n.mindId, taskLedger, n.streaming) }));
    const activeIndex = workers.findIndex((n) => n.state === 'active');
    const planning = activeSpeaker?.phase === 'synthesizing' || (anyStreaming && activeIndex < 0);
    body = (
      <Cluster
        top={<Node {...hub.props} state={planning ? 'planning' : 'idle'} role={hub.role} size="lg" />}
        centerActive={planning}
        centerColor={activeIndex >= 0 ? workers[activeIndex].props.color : hub.props.color}
        nodes={workers}
        activeIndex={activeIndex >= 0 ? activeIndex : null}
      />
    );
    const done = taskLedger.filter((t) => t.status === 'completed').length;
    if (taskLedger.length > 0) caption = `${done}/${taskLedger.length} tasks complete.`;
    else if (planning) caption = `${hub.props.name} is planning the work.`;
  }

  return (
    <div className="px-4 py-3 border-b border-border bg-card/30" data-testid="orchestration-diagram" data-mode={mode}>
      {body}
      <p className="mt-2 text-center text-[11px] text-muted-foreground leading-snug">{caption}</p>
    </div>
  );
}

function workerState(mindId: string, ledger: TaskLedgerItem[], streaming: boolean): NodeState {
  const tasks = ledger.filter((t) => t.assignee === mindId);
  if (tasks.some((t) => t.status === 'in-progress')) return 'active';
  if (tasks.length > 0 && tasks.every((t) => t.status === 'completed')) return 'done';
  if (tasks.some((t) => t.status === 'failed')) return 'failed';
  if (streaming) return 'active';
  return 'idle';
}
