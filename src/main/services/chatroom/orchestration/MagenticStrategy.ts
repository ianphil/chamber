import { randomUUID } from 'node:crypto';
import type { MindContext } from '../../../../shared/types';
import type {
  MagenticConfig,
  TaskLedgerItem,
} from '../../../../shared/chatroom-types';
import type { OrchestrationContext } from './types';
import { BaseStrategy } from './types';
import { ObservabilityEmitter } from './observability';
import { escapeXml, textContent, extractJsonObject, stripControlJson } from './shared';
import { sendToAgentWithRetry } from './stream-agent';

// ---------------------------------------------------------------------------
// Manager response parsing
// ---------------------------------------------------------------------------

interface ManagerDecision {
  action: 'assign' | 'complete' | 'update-plan';
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
    const action = (['assign', 'complete', 'update-plan'] as const).includes(
      parsed.action as 'assign' | 'complete' | 'update-plan',
    )
      ? (parsed.action as 'assign' | 'complete' | 'update-plan')
      : 'assign';
    return {
      action,
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
 * Closest equivalent to "Magentic-One" style orchestration:
 * - A manager agent maintains a shared task ledger (plan with status)
 * - Manager selects the next agent from a known allowlist
 * - Step budget + termination criteria enforced
 * - Each agent is a full Copilot SDK session with complete tool access
 *   (file I/O, terminal, search, MCP) — more capable than Magentic-One's
 *   narrow specialist tools (WebSurfer, FileSurfer, Coder)
 *
 * Current limitation:
 * - Single-threaded execution (one worker per step, no parallel sub-tasks)
 */
export class MagenticStrategy extends BaseStrategy {
  readonly mode = 'magentic' as const;
  private readonly config: MagenticConfig;

  constructor(config: MagenticConfig) {
    super();
    this.config = config;
  }

  async execute(
    userMessage: string,
    participants: MindContext[],
    roundId: string,
    context: OrchestrationContext,
  ): Promise<void> {
    if (participants.length === 0) return;

    this.begin();

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
        transformContent: (raw) => stripControlJson(raw, (a) => ['assign', 'complete', 'update-plan'].includes(a as string)),
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

    // ── Phase 2: Manager-driven execution loop ──

    for (step = 0; step < this.config.maxSteps; step++) {
      if (this.isAborted) break;

      // Check if all tasks are completed
      const allDone = ledger.every(
        (t) => t.status === 'completed' || t.status === 'failed',
      );
      if (allDone) {
        obs.terminationReason('ALL_TASKS_COMPLETE', { step });
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
          transformContent: (raw) => stripControlJson(raw, (a) => ['assign', 'complete', 'update-plan'].includes(a as string)),
        }));
      } catch (err) {
        obs.failure(`Assignment failed: ${err instanceof Error ? err.message : String(err)}`, { step });
        break;
      }
      const assignDecision = parseManagerResponse(assignRawContent);

      if (!assignDecision) {
        // Manager didn't produce a valid decision — treat as complete
        obs.terminationReason('MANAGER_NO_DECISION', { step });
        break;
      }

      if (assignDecision.action === 'complete') {
        obs.terminationReason('MANAGER_COMPLETE', { step, summary: assignDecision.summary });

        // Emit synthesis
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

      if (assignDecision.action === 'assign' && assignDecision.assignee) {
        // Validate assignee is in allowlist
        const worker = workers.find(
          (w) => w.identity.name.toLowerCase() === assignDecision.assignee!.toLowerCase(),
        );
        if (!worker) {
          obs.failure(`Manager selected unknown agent: ${assignDecision.assignee}`, { step });
          continue; // Skip this step, let manager try again
        }

        // Find or create the task in ledger
        let task = assignDecision.taskId
          ? ledger.find((t) => t.id === assignDecision.taskId)
          : ledger.find((t) => t.status === 'pending');

        if (!task) {
          // Create new task if manager is adding work
          task = {
            id: assignDecision.taskId || randomUUID().slice(0, 8),
            description: assignDecision.taskDescription || 'Task assigned by manager',
            status: 'pending',
          };
          ledger.push(task);
        }

        task.status = 'in-progress';
        task.assignee = worker.mindId;
        this.emitLedgerUpdate(manager, roundId, ledger, context);

        // Emit turn-start for worker
        context.emitEvent({
          mindId: worker.mindId,
          mindName: worker.identity.name,
          messageId: '',
          roundId,
          event: {
            type: 'orchestration:turn-start',
            data: { speaker: worker.identity.name, speakerMindId: worker.mindId, step },
          },
        });

        obs.agentStep(worker.mindId, { step, taskId: task.id });

        // Build worker prompt
        const workerPrompt = this.buildWorkerPrompt(
          userMessage,
          participants,
          task,
          ledger,
          context,
          worker,
        );

        try {
          const { message: workerResponse } = await sendToAgentWithRetry({
            mind: worker,
            prompt: workerPrompt,
            roundId,
            context,
            abortSignal: this.abortController!.signal,
            unsubs: this.currentUnsubs,
            orchestrationMode: 'magentic',
          });
          const workerText = workerResponse ? textContent(workerResponse) : '';

          task.status = 'completed';
          task.result = workerText.slice(0, 500); // Safe summary only
          this.emitLedgerUpdate(manager, roundId, ledger, context);
        } catch (err) {
          task.status = 'failed';
          task.result = String(err);
          this.emitLedgerUpdate(manager, roundId, ledger, context);
          obs.failure(String(err), { step, mindId: worker.mindId, taskId: task.id });
        }
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
    const safeLedger = ledger.map((t) => ({
      id: t.id,
      description: t.description.slice(0, 100),
      status: t.status,
      assignee: t.assignee,
    }));

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
  // Prompt building
  // -------------------------------------------------------------------------

  private buildPlanPrompt(userMessage: string, workers: MindContext[]): string {
    const workerList = workers.map((w) => `  - ${w.identity.name}`).join('\n');

    let xml = `<magentic-planning>\n`;
    xml += `  <user-question>${escapeXml(userMessage)}</user-question>\n`;
    xml += `  <available-agents>\n${workerList}\n  </available-agents>\n`;
    xml += `  <instruction>\n`;
    xml += `    YOU ARE THE MANAGER. Break down the user's question into a plan.\n`;
    xml += `    Create a list of tasks that can be assigned to the available agents.\n`;
    xml += `    Each agent has different expertise — match tasks to the best agent.\n\n`;
    xml += `    RESPOND WITH EXACTLY THIS JSON FORMAT AND NOTHING ELSE:\n`;
    xml += `    {"action": "update-plan", "plan": [{"id": "1", "description": "task description"}, ...]}\n`;
    xml += `  </instruction>\n`;
    xml += `</magentic-planning>`;

    return xml;
  }

  private buildAssignPrompt(
    userMessage: string,
    workers: MindContext[],
    ledger: TaskLedgerItem[],
  ): string {
    const workerList = workers.map((w) => `  - ${w.identity.name}`).join('\n');
    const ledgerXml = ledger
      .map(
        (t) =>
          `    <task id="${escapeXml(t.id)}" status="${t.status}" assignee="${escapeXml(t.assignee ?? 'unassigned')}">${escapeXml(t.description)}${t.result ? ` [result: ${escapeXml(t.result.slice(0, 100))}]` : ''}</task>`,
      )
      .join('\n');

    let xml = `<magentic-assign>\n`;
    xml += `  <user-question>${escapeXml(userMessage)}</user-question>\n`;
    xml += `  <available-agents>\n${workerList}\n  </available-agents>\n`;
    xml += `  <task-ledger>\n${ledgerXml}\n  </task-ledger>\n`;
    xml += `  <instruction>\n`;
    xml += `    Review the task ledger. Decide the next action:\n`;
    xml += `    1. ASSIGN a pending task to an agent:\n`;
    xml += `       {"action": "assign", "assignee": "agent name", "task_id": "task id", "task_description": "what to do"}\n`;
    xml += `    2. COMPLETE — all tasks done, provide summary:\n`;
    xml += `       {"action": "complete", "summary": "final summary"}\n\n`;
    xml += `    Only assign to agents listed above. RESPOND WITH JSON ONLY.\n`;
    xml += `  </instruction>\n`;
    xml += `</magentic-assign>`;

    return xml;
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

    // Show completed tasks for context
    const completedTasks = ledger.filter((t) => t.status === 'completed' && t.result);
    let xml = '';

    if (completedTasks.length > 0) {
      xml += `<completed-tasks>\n`;
      for (const t of completedTasks) {
        xml += `  <task id="${escapeXml(t.id)}">${escapeXml(t.description)}: ${escapeXml(t.result!.slice(0, 200))}</task>\n`;
      }
      xml += `</completed-tasks>\n\n`;
    }

    xml += `<assigned-task id="${escapeXml(task.id)}">${escapeXml(task.description)}</assigned-task>\n`;
    xml += `Complete the assigned task above. Provide a thorough response.\n\n`;

    return xml + basePrompt;
  }
}
