import React from 'react';
import type { TaskLedgerItem } from '../../../shared/chatroom-types';

interface TaskLedgerPanelProps {
  ledger: TaskLedgerItem[];
  minds: Array<{ mindId: string; identity: { name: string } }>;
  onRetry?: (taskId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  'pending': 'border-zinc-600 bg-zinc-800',
  'in-progress': 'border-blue-400 bg-blue-400/20',
  'completed': 'border-green-400 bg-green-400/20',
  'failed': 'border-red-400 bg-red-400/20',
};

const LINE_COLORS: Record<string, string> = {
  'pending': 'bg-zinc-700',
  'in-progress': 'bg-blue-400/50',
  'completed': 'bg-green-400/50',
  'failed': 'bg-red-400/50',
};

const STATUS_LABELS: Record<string, string> = {
  'pending': 'Pending',
  'in-progress': 'In Progress',
  'completed': 'Done',
  'failed': 'Failed',
};

export function TaskLedgerPanel({ ledger, minds, onRetry }: TaskLedgerPanelProps) {
  if (ledger.length === 0) return null;

  const resolveName = (mindId?: string): string => {
    if (!mindId) return '';
    return minds.find((m) => m.mindId === mindId)?.identity.name ?? mindId;
  };

  const completedCount = ledger.filter((t) => t.status === 'completed').length;
  const totalCount = ledger.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="border border-zinc-800 rounded-md p-3 mx-4 mb-3 bg-zinc-900/50 max-h-48 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Task Ledger</span>
        <span className="text-xs text-zinc-500">{completedCount}/{totalCount}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-zinc-800 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Timeline */}
      <div className="relative">
        {ledger.map((task, idx) => {
          const isLast = idx === ledger.length - 1;
          const assigneeName = resolveName(task.assignee);
          // Detect dependency: tasks after the first that are in-progress or pending
          // while earlier tasks are completed → synthesis/dependent task
          const hasDependency = idx > 0 && ledger.slice(0, idx).some((t) => t.status === 'completed');

          return (
            <div key={task.id} className="flex gap-3 relative">
              {/* Timeline node + connector */}
              <div className="flex flex-col items-center shrink-0 w-4">
                <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${STATUS_COLORS[task.status] ?? 'border-zinc-600 bg-zinc-800'} ${task.status === 'in-progress' ? 'animate-pulse' : ''}`} />
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-[16px] ${LINE_COLORS[task.status] ?? 'bg-zinc-700'}`} />
                )}
              </div>

              {/* Task content */}
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200 truncate flex-1" title={task.description}>
                    {hasDependency && idx === ledger.length - 1 && <span className="text-zinc-500 mr-1">↳</span>}
                    {task.description}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                    task.status === 'completed' ? 'bg-green-400/10 text-green-400'
                    : task.status === 'failed' ? 'bg-red-400/10 text-red-400'
                    : task.status === 'in-progress' ? 'bg-blue-400/10 text-blue-400'
                    : 'bg-zinc-700 text-zinc-400'
                  }`}>
                    {STATUS_LABELS[task.status] ?? task.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {assigneeName && (
                    <span className="text-xs text-zinc-500">{assigneeName}</span>
                  )}
                  {task.status === 'failed' && onRetry && (
                    <button
                      onClick={() => onRetry(task.id)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-medium"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
