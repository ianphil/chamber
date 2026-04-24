import { randomUUID } from 'node:crypto';
import type { MindContext } from '../../../../shared/types';
import type {
  MagenticConfig,
  TaskLedgerItem,
} from '../../../../shared/chatroom-types';
import type { OrchestrationContext } from './types';
import { BaseStrategy } from './types';
import { ObservabilityEmitter } from './observability';
import { textContent, extractJsonObject } from './shared';
import { sendToAgentWithRetry, TurnTimeoutError } from './stream-agent';

/** Max characters stored in task.result (safe summary only) */
const MAX_RESULT_LENGTH = 500;

/** Default max time (ms) a worker agent has to complete its turn before being timed out */
const DEFAULT_WORKER_TIMEOUT_MS = 120_000;

/** Optional overrides for tests and advanced configuration */
export interface MagenticStrategyOptions {
  /** Override the per-worker turn timeout (ms). Default: 120_000. */
  workerTimeoutMs?: number;
}

/** Mark a task as failed and emit observability event */
function failTask(
  task: TaskLedgerItem,
  err: unknown,
  obs: ObservabilityEmitter,
  extra: Record<string, unknown>,
): void {
  task.status = 'failed';
  task.result = String(err);
  obs.failure(task.result, extra);
}

/** Format manager's JSON response into human-readable text for display */
function formatManagerResponse(raw: string): string {
  const json = extractJsonObject(raw);
  if (!json) return raw;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const action = parsed.action as string;

    if (action === 'update-plan' && Array.isArray(parsed.plan)) {
      const tasks = parsed.plan as Array<{ id: string; description: string }>;
      const lines = ['**Planning:** Breaking this into tasks:\n'];
      for (const t of tasks) {
        lines.push(`${t.id}. ${t.description}`);
      }
      return lines.join('\n');
    }

    if (action === 'plan-and-assign') {
      const parts: string[] = [];
      if (Array.isArray(parsed.plan)) {
        const tasks = parsed.plan as Array<{ id: string; description: string }>;
        parts.push('**Planning:** Breaking this into tasks:\n');
        for (const t of tasks) {
          parts.push(`${t.id}. ${t.description}`);
        }
      }
      if (Array.isArray(parsed.assignments)) {
        if (parts.length > 0) parts.push('');
        parts.push('**Assigning tasks:**\n');
        for (const a of parsed.assignments as Array<{ assignee: string; task_description?: string }>) {
          parts.push(`- **${a.assignee}**: ${a.task_description ?? 'assigned task'}`);
        }
      }
      return parts.length > 0 ? parts.join('\n') : raw;
    }

    if (action === 'assign') {
      const assignments = Array.isArray(parsed.assignments)
        ? (parsed.assignments as Array<{ assignee: string; task_description?: string }>)
        : parsed.assignee
          ? [{ assignee: parsed.assignee as string, task_description: parsed.task_description as string | undefined }]
          : [];
      if (assignments.length === 0) return raw;
      const lines = ['**Assigning tasks:**\n'];
      for (const a of assignments) {
        lines.push(`- **${a.assignee}**: ${a.task_description ?? 'assigned task'}`);
      }
      return lines.join('\n');
    }

    if (action === 'complete') {
      return `**Summary:** ${(parsed.summary as string) ?? 'All tasks completed.'}`;
    }

    return raw;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Manager response parsing
// ---------------------------------------------------------------------------

interface ManagerDecision {
  action: 'assign' | 'complete' | 'update-plan' | 'plan-and-assign';
  assignments?: Array<{ assignee: string; taskId?: string; taskDescription?: string }>;
  assignee?: string;
  taskDescription?: string;
  taskId?: string;
  planUpdate?: Array<{ id: string; description: string }>;
  summary?: string;
}

function parseManagerResponse(text: string): ManagerDecision | null {
  const json = extractJsonObject(text);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const validActions = ['assign', 'complete', 'update-plan', 'plan-and-assign'] as const;
    const action = validActions.includes(parsed.action as typeof validActions[number])
      ? (parsed.action as typeof validActions[number])
      : 'assign';
    return {
      action,
      assignments: Array.isArray(parsed.assignments)
        ? (parsed.assignments as Array<{ assignee: string; taskId?: string; taskDescription?: string }>)
        : undefined,
      assignee: typeof parsed.assignee === 'string' ? parsed.assignee : undefined,
      taskDescription: typeof parsed.task_description === 'string' ? parsed.task_description : undefined,
      taskId: typeof parsed.task_id === 'string' ? parsed.task_id : undefined,
      planUpdate: Array.isArray(parsed.plan)
        ? (parsed.plan as Array<{ id: string; description: string }>)
        : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MagenticStrategy — manager-driven dynamic collaboration with task ledger
// ---------------------------------------------------------------------------

/**
 * Magentic-One inspired orchestration:
 * - A manager agent maintains a shared task ledger (plan with status)
 * - Manager selects agents from a known allowlist
 * - Step budget + termination criteria enforced
 * - Each agent is a full Copilot SDK session with complete tool access
 *
 * v2 improvements:
 * - Clean worker prompts (natural language, not XML directives)
 * - Parallel task execution via A2A when multiple tasks are assigned
 * - Control JSON stripped from history to prevent prompt injection warnings
 */
export class MagenticStrategy extends BaseStrategy {
  readonly mode = 'magentic' as const;
  private readonly config: MagenticConfig;
  private readonly workerTimeoutMs: number;

  constructor(config: MagenticConfig, options: MagenticStrategyOptions = {}) {
    super();
    this.config = config;
    this.workerTimeoutMs = options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  }

  async execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (participants.length === 0) return;

    this.begin();

    const startTime = Date.now();
    const obs = new ObservabilityEmitter('magentic');
    obs.start({ participantCount: participants.length, maxSteps: this.config.maxSteps });

    // Resolve manager
    const manager = participants.find((p) => p.mindId === this.config.managerMindId);
    if (!manager) {
      console.error('[Chatroom:Magentic] Manager mind not found among participants');
      obs.failure('Manager mind not found');
      obs.end({ terminationReason: 'ERROR' });
      return;
    }

    // Build allowlist
    const allowedIds = new Set(
      this.config.allowedMindIds ?? participants.map((p) => p.mindId),
    );
    const workers = participants.filter(
      (p) => p.mindId !== this.config.managerMindId && allowedIds.has(p.mindId),
    );

    if (workers.length === 0) {
      obs.failure('No workers available');
      obs.end({ terminationReason: 'ERROR' });
      return;
    }

    // Task ledger
    const ledger: TaskLedgerItem[] = [];
    let step = 0;

    // ── Phase 1: Manager creates initial plan ──

    const planPrompt = this.buildPlanPrompt(userMessage, workers);

    context.emitEvent({
      mindId: manager.mindId,
      mindName: manager.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:manager-plan',
        data: { phase: 'initial-planning' },
      },
    });

    let planRawContent: string;
    try {
      ({ rawContent: planRawContent } = await sendToAgentWithRetry({
        mind: manager,
        prompt: planPrompt,
        roundId,
        context,
        abortSignal: this.abortController!.signal,
        unsubs: this.currentUnsubs,
        orchestrationMode: 'magentic',
        silent: true,
      }));
    } catch (err) {
      obs.failure(`Planning failed: ${err instanceof Error ? err.message : String(err)}`);
      obs.end({ terminationReason: 'ERROR' });
      return;
    }
    const planDecision = parseManagerResponse(planRawContent);

    // Populate ledger from plan
    if (planDecision?.planUpdate) {
      for (const item of planDecision.planUpdate) {
        ledger.push({
          id: item.id || randomUUID().slice(0, 8),
          description: item.description,
          status: 'pending',
        });
      }
    } else {
      // Fallback: single task
      ledger.push({
        id: randomUUID().slice(0, 8),
        description: userMessage,
        status: 'pending',
      });
    }

    this.emitLedgerUpdate(manager, roundId, ledger, context);

    // Emit a formatted plan message so the user sees what the manager decided
    const planSummary = formatManagerResponse(planRawContent);
    if (planSummary !== planRawContent) {
      this.emitSyntheticMessage(manager, roundId, planSummary, context);
    }

    // ── Phase 1b: Execute initial assignments if plan-and-assign ──

    if (planDecision?.action === 'plan-and-assign' && planDecision.assignments?.length) {
      const resolved = this.resolveAssignments(planDecision.assignments, workers, ledger, obs, 0);
      if (resolved.length > 0) {
        this.emitLedgerUpdate(manager, roundId, ledger, context);

        // Emit formatted assignment message
        const assignSummary = formatManagerResponse(planRawContent);
        // Only emit if different from plan (avoid duplicate)
        if (assignSummary === planSummary) {
          const assignLines = ['**Assigning tasks:**\n'];
          for (const { worker, task } of resolved) {
            assignLines.push(`- **${worker.identity.name}**: ${task.description}`);
          }
          this.emitSyntheticMessage(manager, roundId, assignLines.join('\n'), context);
        }

        await this.executeAssignments(resolved, userMessage, participants, ledger, roundId, context, obs, 0);
        this.emitLedgerUpdate(manager, roundId, ledger, context);
      }
    }

    // ── Phase 2: Manager-driven execution loop ──

    for (step = 0; step < this.config.maxSteps; step++) {
      if (this.isAborted) break;

      // Check if all tasks are completed
      const allDone = ledger.every(
        (t) => t.status === 'completed' || t.status === 'failed',
      );
      if (allDone) {
        obs.terminationReason('ALL_TASKS_COMPLETE', { step });

        // Ask manager for a brief synthesis instead of a generic completion message
        await this.emitManagerSynthesis(manager, userMessage, ledger, roundId, context);

        break;
      }

      // Ask manager to assign next task
      const assignPrompt = this.buildAssignPrompt(userMessage, workers, ledger);

      let assignRawContent: string;
      try {
        ({ rawContent: assignRawContent } = await sendToAgentWithRetry({
          mind: manager,
          prompt: assignPrompt,
          roundId,
          context,
          abortSignal: this.abortController!.signal,
          unsubs: this.currentUnsubs,
          orchestrationMode: 'magentic',
          silent: true,
        }));
      } catch (err) {
        obs.failure(`Assignment failed: ${err instanceof Error ? err.message : String(err)}`, { step });
        break;
      }
      const assignDecision = parseManagerResponse(assignRawContent);

      if (!assignDecision) {
        // Manager didn't produce a valid decision — treat as complete
        obs.terminationReason('MANAGER_NO_DECISION', { step });
        context.emitEvent({
          mindId: manager.mindId,
          mindName: manager.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:magentic-terminated',
            data: { reason: 'MANAGER_NO_DECISION', step },
          },
        });
        break;
      }

      if (assignDecision.action === 'complete') {
        obs.terminationReason('MANAGER_COMPLETE', { step, summary: assignDecision.summary });

        // Emit summary message so the user sees the manager's conclusion
        const summaryText = assignDecision.summary
          ? `**Summary:** ${assignDecision.summary}`
          : '**All tasks completed.**';
        this.emitSyntheticMessage(manager, roundId, summaryText, context);

        // Emit synthesis orchestration event
        context.emitEvent({
          mindId: manager.mindId,
          mindName: manager.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:synthesis',
            data: { synthesizer: manager.identity.name, summary: assignDecision.summary },
          },
        });
        break;
      }

      if (assignDecision.action === 'assign') {
        // Normalize to assignments array (support both single and batch)
        const assignments = assignDecision.assignments
          ?? (assignDecision.assignee
            ? [{ assignee: assignDecision.assignee, taskId: assignDecision.taskId, taskDescription: assignDecision.taskDescription }]
            : []);

        if (assignments.length === 0) {
          obs.failure('Manager assigned with no assignee', { step });
          continue;
        }

        const resolved = this.resolveAssignments(assignments, workers, ledger, obs, step);

        this.emitLedgerUpdate(manager, roundId, ledger, context);

        // Emit formatted assignment message
        const assignSummary = formatManagerResponse(assignRawContent);
        if (assignSummary !== assignRawContent) {
          this.emitSyntheticMessage(manager, roundId, assignSummary, context);
        }

        // Execute workers: run independent tasks concurrently via separate
        // SDK sessions (each worker has its own mindId → own session).
        // Dependent tasks (those whose prompt references completed results)
        // are held until their dependencies finish.
        await this.executeAssignments(resolved, userMessage, participants, ledger, roundId, context, obs, step);

        this.emitLedgerUpdate(manager, roundId, ledger, context);
      }
    }

    // Step budget exhausted
    if (step >= this.config.maxSteps) {
      obs.terminationReason('STEP_BUDGET_EXHAUSTED', { maxSteps: this.config.maxSteps });

      context.emitEvent({
        mindId: manager.mindId,
        mindName: manager.identity.name,
        messageId: '',
        roundId,
        event: {
          type: 'orchestration:magentic-terminated',
          data: { reason: 'STEP_BUDGET_EXHAUSTED', maxSteps: this.config.maxSteps },
        },
      });
    }

    // Emit orchestration metrics for the renderer
    const elapsedMs = Date.now() - startTime;
    const completedCount = ledger.filter((t) => t.status === 'completed').length;
    const failedCount = ledger.filter((t) => t.status === 'failed').length;
    const workerIds = new Set(ledger.map((t) => t.assignee).filter(Boolean));
    context.emitEvent({
      mindId: manager.mindId,
      mindName: manager.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:metrics',
        data: {
          elapsedMs,
          totalTasks: ledger.length,
          completedTasks: completedCount,
          failedTasks: failedCount,
          agentsUsed: workerIds.size,
          orchestrationMode: 'magentic',
        },
      },
    });

    obs.end({ totalSteps: step, ledgerSize: ledger.length });
  }

  // -------------------------------------------------------------------------
  // Task ledger emission (non-sensitive)
  // -------------------------------------------------------------------------

  private emitLedgerUpdate(
    manager: MindContext,
    roundId: string,
    ledger: TaskLedgerItem[],
    context: OrchestrationContext,
  ): void {
    // Persist a safe view of the ledger — no chain-of-thought, only metadata
    const safeLedger = ledger.map((t) => {
      let desc = t.description;
      if (desc.length > 80) {
        const cut = desc.lastIndexOf(' ', 80);
        desc = desc.slice(0, cut > 20 ? cut : 80) + '…';
      }
      return { id: t.id, description: desc, status: t.status, assignee: t.assignee };
    });

    context.emitEvent({
      mindId: manager.mindId,
      mindName: manager.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:task-ledger-update',
        data: { ledger: safeLedger },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Assignment resolution — maps manager decisions to worker+task pairs
  // -------------------------------------------------------------------------

  private resolveAssignments(
    assignments: Array<{ assignee: string; taskId?: string; taskDescription?: string }>,
    workers: MindContext[],
    ledger: TaskLedgerItem[],
    obs: ObservabilityEmitter,
    step: number,
  ): Array<{ worker: MindContext; task: TaskLedgerItem }> {
    const resolved: Array<{ worker: MindContext; task: TaskLedgerItem }> = [];
    for (const a of assignments) {
      const worker = workers.find(
        (w) => w.identity.name.toLowerCase() === a.assignee.toLowerCase(),
      );
      if (!worker) {
        obs.failure(`Manager selected unknown agent: ${a.assignee}`, { step });
        continue;
      }

      let task = a.taskId
        ? ledger.find((t) => t.id === a.taskId)
        : ledger.find((t) => t.status === 'pending');

      if (!task) {
        task = {
          id: a.taskId || randomUUID().slice(0, 8),
          description: a.taskDescription || 'Task assigned by manager',
          status: 'pending',
        };
        ledger.push(task);
      }

      task.status = 'in-progress';
      task.assignee = worker.mindId;
      resolved.push({ worker, task });
    }
    return resolved;
  }

  // -------------------------------------------------------------------------
  // Synthetic message emission — renders manager decisions in the chatroom
  // -------------------------------------------------------------------------

  /**
   * Emit a fully-formed message from the manager into the renderer.
   * Sends `message_final` (which auto-creates a placeholder in the reducer)
   * then `done` to mark streaming complete, using a consistent messageId.
   */
  private emitSyntheticMessage(
    mind: MindContext,
    roundId: string,
    content: string,
    context: OrchestrationContext,
  ): void {
    const messageId = randomUUID();

    // message_final triggers auto-placeholder creation + content population
    context.emitEvent({
      mindId: mind.mindId,
      mindName: mind.identity.name,
      messageId,
      roundId,
      event: { type: 'message_final', sdkMessageId: messageId, content },
    });

    // Persist for storage consistency
    context.persistMessage({
      id: messageId,
      role: 'assistant',
      blocks: [{ type: 'text', content }],
      timestamp: Date.now(),
      sender: { mindId: mind.mindId, name: mind.identity.name },
      roundId,
      orchestrationMode: 'magentic',
    });

    // Mark streaming complete
    context.emitEvent({
      mindId: mind.mindId,
      mindName: mind.identity.name,
      messageId,
      roundId,
      event: { type: 'done' },
    });
  }

  /**
   * Ask the manager for a brief synthesis of all completed work.
   * Falls back to a generic message if the synthesis call fails.
   */
  private async emitManagerSynthesis(
    manager: MindContext,
    userMessage: string,
    ledger: TaskLedgerItem[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    const completed = ledger.filter((t) => t.status === 'completed').length;
    const failed = ledger.filter((t) => t.status === 'failed').length;

    try {
      const prompt = this.buildSynthesisPrompt(userMessage, ledger);

      // Emit turn-start so the typing indicator shows the manager synthesizing
      context.emitEvent({
        mindId: manager.mindId,
        mindName: manager.identity.name,
        messageId: '',
        roundId,
        event: { type: 'orchestration:synthesis', data: { synthesizer: manager.identity.name } },
      });

      // Stream synthesis visibly — the user sees the manager composing the summary
      const { rawContent } = await sendToAgentWithRetry({
        mind: manager,
        prompt,
        roundId,
        context,
        abortSignal: this.abortController!.signal,
        unsubs: this.currentUnsubs,
        orchestrationMode: 'magentic',
      });
      // rawContent captured but message already persisted by sendToAgentWithRetry
      void rawContent;
    } catch {
      // Synthesis failed — emit a generic completion message
      const fallback = failed > 0
        ? `**Orchestration complete.** ${completed} of ${ledger.length} tasks finished (${failed} failed).`
        : `**All ${completed} tasks completed successfully.**`;
      this.emitSyntheticMessage(manager, roundId, fallback, context);
    }
  }

  // -------------------------------------------------------------------------
  // Task execution — workers always run via Promise.all with isolated unsubs
  // -------------------------------------------------------------------------

  /**
   * Run all assigned worker tasks. Each worker gets its own unsubs array so
   * SDK listeners cannot leak between concurrent turns. A single assignment
   * still goes through Promise.all (it's a no-op wrapper for length 1).
   */
  private async executeAssignments(
    resolved: Array<{ worker: MindContext; task: TaskLedgerItem }>,
    userMessage: string,
    participants: MindContext[],
    ledger: TaskLedgerItem[],
    roundId: string,
    context: OrchestrationContext,
    obs: ObservabilityEmitter,
    step: number,
  ): Promise<void> {
    const isParallel = resolved.length > 1;
    const manager = participants.find((p) => p.mindId === this.config.managerMindId);

    await Promise.all(
      resolved.map(({ worker, task }) =>
        this.runWorkerTask({
          worker, task, userMessage, participants, ledger,
          roundId, context, obs, step, isParallel, manager,
        }),
      ),
    );
  }

  /**
   * Execute a single worker task. Owns its own `unsubs` array so multiple
   * concurrent invocations can safely share `this.abortController` without
   * tearing down each other's SDK listeners.
   */
  private async runWorkerTask(args: {
    worker: MindContext;
    task: TaskLedgerItem;
    userMessage: string;
    participants: MindContext[];
    ledger: TaskLedgerItem[];
    roundId: string;
    context: OrchestrationContext;
    obs: ObservabilityEmitter;
    step: number;
    isParallel: boolean;
    manager?: MindContext;
  }): Promise<void> {
    const {
      worker, task, userMessage, participants, ledger,
      roundId, context, obs, step, isParallel, manager,
    } = args;

    if (this.isAborted) return;

    this.emitTurnStart(worker, roundId, context, step, isParallel);
    obs.agentStep(worker.mindId, { step, taskId: task.id, ...(isParallel ? { parallel: true } : {}) });

    const workerPrompt = this.buildWorkerPrompt(userMessage, participants, task, ledger, context, worker);
    const workerUnsubs: (() => void)[] = [];

    try {
      const { message: workerResponse } = await sendToAgentWithRetry({
        mind: worker,
        prompt: workerPrompt,
        roundId,
        context,
        abortSignal: this.abortController!.signal,
        unsubs: workerUnsubs,
        orchestrationMode: 'magentic',
        turnTimeout: this.workerTimeoutMs,
      });
      const workerText = workerResponse ? textContent(workerResponse) : '';
      task.status = 'completed';
      task.result = workerText.slice(0, MAX_RESULT_LENGTH);
    } catch (err) {
      if (err instanceof TurnTimeoutError) {
        task.status = 'failed';
        task.result = `Timed out after ${this.workerTimeoutMs / 1000}s`;
        obs.failure(task.result, { step, mindId: worker.mindId, taskId: task.id });
      } else {
        failTask(task, err, obs, { step, mindId: worker.mindId, taskId: task.id });
      }
    }

    // Emit ledger update as each worker finishes (shows live progress)
    if (manager) {
      this.emitLedgerUpdate(manager, roundId, ledger, context);
    }
  }

  private emitTurnStart(
    worker: MindContext, roundId: string, context: OrchestrationContext,
    step: number, parallel: boolean,
  ): void {
    context.emitEvent({
      mindId: worker.mindId,
      mindName: worker.identity.name,
      messageId: '',
      roundId,
      event: {
        type: 'orchestration:turn-start',
        data: { speaker: worker.identity.name, speakerMindId: worker.mindId, step, ...(parallel ? { parallel: true } : {}) },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Prompt building
  // -------------------------------------------------------------------------

  private buildPlanPrompt(userMessage: string, workers: MindContext[]): string {
    const workerList = workers.map((w) => `  - ${w.identity.name}`).join('\n');

    // Combined plan + first assignment in a single call to save one LLM round trip.
    // The agent has tools and will try to answer directly — we must prevent that.
    return [
      `You are acting as a COORDINATOR in a multi-agent system. You do NOT answer questions yourself.`,
      `Your ONLY job is to break the user's request into tasks, then assign ALL of them immediately.`,
      ``,
      `DO NOT use any tools. DO NOT answer the question. DO NOT provide analysis.`,
      `DO NOT write files, search, or run commands. ONLY output the JSON below.`,
      ``,
      `User request: ${userMessage}`,
      ``,
      `Available agents who will do the actual work:`,
      workerList,
      ``,
      `Break the request into 2-5 concrete tasks and assign each to the best-suited agent.`,
      `Each task should be a self-contained unit of work that one agent can complete independently.`,
      `Independent tasks will be executed in parallel, so assign them all at once.`,
      ``,
      `Output ONLY this JSON, nothing else:`,
      `{"action": "plan-and-assign", "plan": [{"id": "1", "description": "first task"}], "assignments": [{"assignee": "agent name", "task_id": "1", "task_description": "detailed instructions"}]}`,
      ``,
      `Example for "Compare Redis vs Memcached and write a recommendation":`,
      `{"action": "plan-and-assign", "plan": [{"id": "1", "description": "Research Redis"}, {"id": "2", "description": "Research Memcached"}, {"id": "3", "description": "Write comparison"}], "assignments": [{"assignee": "Agent A", "task_id": "1", "task_description": "Research Redis features, performance, and use cases"}, {"assignee": "Agent B", "task_id": "2", "task_description": "Research Memcached features, performance, and use cases"}]}`,
      ``,
      `Note: Only assign independent tasks now. Tasks that depend on other tasks' results (like task 3 above) should NOT be assigned yet — they will be assigned after their dependencies complete.`,
    ].join('\n');
  }

  private buildAssignPrompt(
    userMessage: string,
    workers: MindContext[],
    ledger: TaskLedgerItem[],
  ): string {
    const workerList = workers.map((w) => `  - ${w.identity.name}`).join('\n');
    const ledgerLines = ledger.map(
      (t) => `  [${t.id}] ${t.status}${t.assignee ? ` (${t.assignee})` : ''}: ${t.description}${t.result ? ` -> ${t.result.slice(0, 80)}` : ''}`,
    ).join('\n');

    return [
      `You are acting as a COORDINATOR. You do NOT answer questions or use tools.`,
      `Your ONLY job is to assign the next task(s) or declare completion.`,
      ``,
      `DO NOT use any tools. DO NOT answer the question. ONLY output JSON.`,
      ``,
      `User request: ${userMessage}`,
      ``,
      `Available agents:`,
      workerList,
      ``,
      `Task ledger:`,
      ledgerLines,
      ``,
      `If there are pending tasks, assign them. If all tasks are completed/failed, provide a summary.`,
      `You may assign multiple independent tasks at once for parallel execution.`,
      ``,
      `Output ONLY one of these JSON formats:`,
      ``,
      `To assign: {"action": "assign", "assignments": [{"assignee": "agent name", "task_id": "1", "task_description": "what to do"}]}`,
      `To complete: {"action": "complete", "summary": "brief summary of all results"}`,
    ].join('\n');
  }

  private buildWorkerPrompt(
    userMessage: string,
    participants: MindContext[],
    task: TaskLedgerItem,
    ledger: TaskLedgerItem[],
    context: OrchestrationContext,
    forMind?: MindContext,
  ): string {
    const basePrompt = context.buildBasePrompt(userMessage, participants, forMind);

    // Natural language context — no XML directives that trigger injection warnings
    const completedTasks = ledger.filter((t) => t.status === 'completed' && t.result);
    const parts: string[] = [];

    if (completedTasks.length > 0) {
      parts.push('Other team members have completed these related tasks:');
      for (const t of completedTasks) {
        parts.push(`- ${t.description}: ${t.result!.slice(0, 200)}`);
      }
      parts.push('');
    }

    parts.push(`Your task: ${task.description}`);
    parts.push('');
    parts.push('Respond concisely and directly. Focus only on this task — do not explore unrelated topics.');
    parts.push('Prefer answering from your knowledge before using tools. Limit tool usage to at most 3 calls.');
    parts.push('');

    return parts.join('\n') + basePrompt;
  }

  private buildSynthesisPrompt(userMessage: string, ledger: TaskLedgerItem[]): string {
    const results = ledger.map((t) => {
      const status = t.status === 'completed' ? '✓' : '✗';
      return `  ${status} [${t.id}] ${t.description}${t.result ? `: ${t.result.slice(0, 200)}` : ''}`;
    }).join('\n');

    return [
      `You are a COORDINATOR wrapping up a multi-agent task. All work is done.`,
      `Write a brief 2-4 sentence synthesis for the user summarizing what was accomplished.`,
      ``,
      `DO NOT use any tools. DO NOT start new work. Just summarize concisely.`,
      ``,
      `Original request: ${userMessage}`,
      ``,
      `Task results:`,
      results,
      ``,
      `Write your synthesis now (plain text, not JSON):`,
    ].join('\n');
  }
}
