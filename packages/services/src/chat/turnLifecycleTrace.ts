// Per-turn SDK lifecycle trace.
//
// Investigation aid for issue #299: chat turns that hang forever because the
// SDK never emits `session.idle`. The trace subscribes to every SDK event for
// a single turn via the single-arg `session.on(handler)` overload and records
// a bounded ring buffer of metadata-only entries. Payload contents are never
// captured (no `arguments`, no message text) — only structural fields.
//
// When the turn ends (idle / error / abort), `ChatService` asks the trace for
// a `summary()` and logs it at debug level. That summary is what lets us
// distinguish, after the fact, between:
//
//   1. SDK never emitted `session.idle` (sawIdle: false, sawTurnEnd: true)
//   2. SDK emitted idle but our typed listener missed it (sawIdle: true, but
//      ChatService still hit the abort/error path)
//   3. Tool / sub-agent work outstanding at the time we stopped waiting
//      (outstandingToolCount > 0)
//
// INVARIANT: this module is observational only. It must not influence whether
// the turn completes, nor emit chat events. The defensive completion path is
// deliberately deferred to a follow-up PR — see ChatService.streamTurn.

export interface LifecycleTraceEntry {
  type: string;
  timestamp: number;
  agentId?: string;
  toolCallId?: string;
  outstandingToolCount: number;
}

export interface LifecycleSummary {
  reason: string;
  eventCount: number;
  durationMs: number;
  outstandingToolCount: number;
  sawIdle: boolean;
  sawTurnEnd: boolean;
  sawRootTurnEnd: boolean;
  entries: LifecycleTraceEntry[];
}

interface RawEvent {
  type: string;
  agentId?: string;
  data?: unknown;
}

function getToolCallId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('toolCallId' in data)) return undefined;
  return typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
}

export class TurnLifecycleTrace {
  static readonly MAX_ENTRIES = 50;

  private readonly entries: LifecycleTraceEntry[] = [];
  private readonly outstandingTools = new Set<string>();
  private firstEventAt: number | undefined;
  private lastEventAt: number | undefined;
  private totalEventCount = 0;
  private sawIdleEver = false;
  private sawTurnEndEver = false;
  private sawRootTurnEndEver = false;

  record(event: RawEvent): void {
    const now = Date.now();
    if (this.firstEventAt === undefined) this.firstEventAt = now;
    this.lastEventAt = now;
    this.totalEventCount += 1;

    if (event.type === 'session.idle') this.sawIdleEver = true;
    if (event.type === 'assistant.turn_end') {
      this.sawTurnEndEver = true;
      // Root-agent turn_end is the only flavor that is plausibly terminal
      // for the chat turn. Sub-agent (agentId !== undefined) turn_end fires
      // routinely in multi-agent / delegated work and is NOT terminal —
      // gating the #299 fingerprint on the root-only flag prevents spurious
      // info-level logs during normal aborts of multi-agent turns.
      if (event.agentId === undefined) this.sawRootTurnEndEver = true;
    }

    const toolCallId = getToolCallId(event.data);
    if (event.type === 'tool.execution_start' && toolCallId) {
      this.outstandingTools.add(toolCallId);
    }
    if (event.type === 'tool.execution_complete' && toolCallId) {
      this.outstandingTools.delete(toolCallId);
    }

    const entry: LifecycleTraceEntry = {
      type: event.type,
      timestamp: now,
      outstandingToolCount: this.outstandingTools.size,
    };
    if (event.agentId !== undefined) entry.agentId = event.agentId;
    if (toolCallId !== undefined) entry.toolCallId = toolCallId;

    this.entries.push(entry);
    if (this.entries.length > TurnLifecycleTrace.MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  summary(reason: string): LifecycleSummary {
    const durationMs =
      this.firstEventAt !== undefined && this.lastEventAt !== undefined
        ? this.lastEventAt - this.firstEventAt
        : 0;
    return {
      reason,
      eventCount: this.totalEventCount,
      durationMs,
      outstandingToolCount: this.outstandingTools.size,
      sawIdle: this.sawIdleEver,
      sawTurnEnd: this.sawTurnEndEver,
      sawRootTurnEnd: this.sawRootTurnEndEver,
      entries: [...this.entries],
    };
  }
}
