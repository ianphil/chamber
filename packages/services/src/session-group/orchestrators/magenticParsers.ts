import type { TaskLedgerItem } from '@chamber/shared/chatroom-types';
import { extractJsonObject } from '../shared';
import type { ObservabilityEmitter } from '../observability';

/** Decoded shape of a manager-emitted JSON envelope. */
export interface ManagerDecision {
  action: 'assign' | 'complete' | 'update-plan' | 'plan-and-assign';
  assignments?: Array<{ assignee: string; taskId?: string; taskDescription?: string }>;
  assignee?: string;
  taskDescription?: string;
  taskId?: string;
  planUpdate?: Array<{ id: string; description: string }>;
  summary?: string;
}

/** Mark a task as failed and emit an observability event. */
export function failTask(
  task: TaskLedgerItem,
  err: unknown,
  obs: ObservabilityEmitter,
  extra: Record<string, unknown>,
): void {
  task.status = 'failed';
  task.result = String(err);
  obs.failure(task.result, extra);
}

/** Format a manager's JSON envelope into human-readable Markdown for display. */
export function formatManagerResponse(raw: string): string {
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

/** Parse a manager response text into a normalized ManagerDecision shape. */
export function parseManagerResponse(text: string): ManagerDecision | null {
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
