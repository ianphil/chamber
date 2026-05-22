import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { LedgerRecord, LedgerStatus, TaskRuntime } from '@chamber/shared';
import type { TaskLedger } from '@chamber/services';

const RUNTIMES: TaskRuntime[] = ['a2a', 'cron', 'acp-child', 'chatroom', 'local'];
const STATUSES: LedgerStatus[] = ['queued', 'running', 'succeeded', 'failed', 'timed-out', 'cancelled', 'lost'];
const STALE_RUNNING_MS = 24 * 60 * 60 * 1000;

export interface TasksIpcLedgerProvider {
  getLedgerForMind(mindId: string): TaskLedger | undefined;
}

export function setupTasksIPC(provider: TasksIpcLedgerProvider): void {
  ipcMain.handle(IPC.TASKS.LIST, async (_event, mindId: string) => listMindTasks(provider, mindId));
  ipcMain.handle(IPC.TASKS.GET, async (_event, mindId: string, ledgerId: string) => {
    const task = findOwnedTask(provider, mindId, ledgerId);
    return task ?? { error: `Unknown task_id: ${ledgerId}` };
  });
  ipcMain.handle(IPC.TASKS.CANCEL, async (_event, mindId: string, ledgerId: string) => {
    const ledger = provider.getLedgerForMind(mindId);
    const task = findOwnedTask(provider, mindId, ledgerId);
    if (!ledger || !task) {
      return { found: false, cancelled: false, reason: `Unknown task_id: ${ledgerId}` };
    }
    return ledger.canceller.cancel(task.ledgerId);
  });
  ipcMain.handle(IPC.TASKS.AUDIT, async (_event, mindId: string) => {
    const tasks = listMindTasks(provider, mindId);
    return {
      counts: countByStatus(tasks),
      findings: classifyFindings(tasks),
    };
  });
}

function listMindTasks(provider: TasksIpcLedgerProvider, mindId: string): LedgerRecord[] {
  const ledger = provider.getLedgerForMind(mindId);
  if (!ledger) return [];
  return RUNTIMES.flatMap((runtime) => ledger.reader.listByRuntime(runtime))
    .filter((task) => task.ownerMindId === mindId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function findOwnedTask(
  provider: TasksIpcLedgerProvider,
  mindId: string,
  ledgerId: string,
): LedgerRecord | undefined {
  const task = provider.getLedgerForMind(mindId)?.reader.getByLedgerId(ledgerId);
  return task?.ownerMindId === mindId ? task : undefined;
}

function countByStatus(tasks: LedgerRecord[]): Record<LedgerStatus, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<LedgerStatus, number>;
  for (const task of tasks) {
    counts[task.status] += 1;
  }
  return counts;
}

function classifyFindings(tasks: LedgerRecord[]): Array<{
  type: 'stale-running' | 'missing-cleanup' | 'delivery-failed';
  ledgerId: string;
}> {
  const now = Date.now();
  return tasks.flatMap((task) => {
    const findings: Array<{ type: 'stale-running' | 'missing-cleanup' | 'delivery-failed'; ledgerId: string }> = [];
    if (
      task.status === 'running'
      && task.lastEventAt
      && now - Date.parse(task.lastEventAt) > STALE_RUNNING_MS
    ) {
      findings.push({ type: 'stale-running', ledgerId: task.ledgerId });
    }
    if (isTerminal(task.status) && !task.cleanupAfter) {
      findings.push({ type: 'missing-cleanup', ledgerId: task.ledgerId });
    }
    if (task.deliveryStatus === 'failed') {
      findings.push({ type: 'delivery-failed', ledgerId: task.ledgerId });
    }
    return findings;
  });
}

function isTerminal(status: LedgerStatus): boolean {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'timed-out'
    || status === 'cancelled'
    || status === 'lost';
}
