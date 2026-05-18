import type { MindContext } from '@chamber/shared/types';
import type { TaskLedgerItem } from '@chamber/shared/chatroom-types';
import type { OrchestrationContext } from './legacy-types';

/**
 * Combined plan + first-assignment prompt sent on the first manager turn.
 *
 * Combines plan + first assignment in a single call to save one LLM round
 * trip. The agent has tools and will try to answer directly — the strict
 * "no tools, no analysis" framing exists to prevent that.
 */
export function buildPlanPrompt(userMessage: string, workers: MindContext[]): string {
  const workerList = workers.map((w) => `  - ${w.identity.name}`).join('\n');

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

/** Mid-loop prompt asking the manager to assign the next task or declare completion. */
export function buildAssignPrompt(
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

/**
 * Worker prompt — natural language only. We deliberately avoid XML directives
 * (e.g. `<task>...</task>`) because models inspecting their own context for
 * prompt-injection patterns frequently flag XML tags as user-injected
 * commands and refuse to act on them. Plain prose with explicit "Your task:"
 * framing avoids the false positive.
 */
export function buildWorkerPrompt(
  userMessage: string,
  participants: MindContext[],
  task: TaskLedgerItem,
  ledger: TaskLedgerItem[],
  context: OrchestrationContext,
  forMind?: MindContext,
): string {
  const basePrompt = context.buildBasePrompt(userMessage, participants, forMind);

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

/** Synthesis prompt — manager produces a brief summary of completed work. */
export function buildSynthesisPrompt(userMessage: string, ledger: TaskLedgerItem[]): string {
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
