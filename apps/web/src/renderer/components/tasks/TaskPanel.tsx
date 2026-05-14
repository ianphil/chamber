import React, { useState } from 'react';
import type { Task, TaskState } from '@chamber/shared/a2a-types';

export interface TaskPanelProps {
  tasksByMind: Record<string, Task[]>;
  mindNames: Record<string, string>;
  onCancelTask?: (taskId: string) => void;
}

const STATUS_COLORS: Record<TaskState, string> = {
  TASK_STATE_SUBMITTED: '#6b7280',
  TASK_STATE_WORKING: '#3b82f6',
  TASK_STATE_COMPLETED: '#22c55e',
  TASK_STATE_FAILED: '#ef4444',
  TASK_STATE_CANCELED: '#6b7280',
  'TASK_STATE_INPUT_REQUIRED': '#eab308',
  TASK_STATE_REJECTED: '#ef4444',
  'TASK_STATE_AUTH_REQUIRED': '#eab308',
};

const TERMINAL_STATES: TaskState[] = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'];

const STATUS_LABELS: Record<TaskState, string> = {
  TASK_STATE_SUBMITTED: 'Submitted',
  TASK_STATE_WORKING: 'Working',
  TASK_STATE_COMPLETED: 'Completed',
  TASK_STATE_FAILED: 'Failed',
  TASK_STATE_CANCELED: 'Canceled',
  TASK_STATE_INPUT_REQUIRED: 'Input Required',
  TASK_STATE_REJECTED: 'Rejected',
  TASK_STATE_AUTH_REQUIRED: 'Auth Required',
};

export function TaskPanel({ tasksByMind, mindNames, onCancelTask }: TaskPanelProps) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const allMinds = Object.keys(tasksByMind);
  if (allMinds.length === 0) {
    return <div className="task-panel-empty">No tasks</div>;
  }

  return (
    <div className="task-panel">
      {allMinds.map(mindId => {
        const tasks = tasksByMind[mindId];
        const name = mindNames[mindId] || mindId;
        return (
          <div key={mindId} className="task-group">
            <h3 className="task-group-header">{name}</h3>
            {tasks.map(task => {
              const isExpanded = expandedTask === task.id;
              const isTerminal = TERMINAL_STATES.includes(task.status.state);
              return (
                <div
                  key={task.id}
                  className="task-item"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <div className="task-summary">
                    <span
                      className="task-status-badge"
                      style={{ backgroundColor: STATUS_COLORS[task.status.state] }}
                      data-testid={`status-badge-${task.id}`}
                    >
                      {STATUS_LABELS[task.status.state]}
                    </span>
                    <span className="task-id">{task.id}</span>
                    {!isTerminal && onCancelTask && (
                      <button
                        className="task-cancel-btn"
                        data-testid={`cancel-btn-${task.id}`}
                        onClick={e => {
                          e.stopPropagation();
                          onCancelTask(task.id);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="task-details" data-testid={`details-${task.id}`}>
                      {task.artifacts && task.artifacts.length > 0 && (
                        <div className="task-artifacts" data-testid={`artifacts-${task.id}`}>
                          <h4>Artifacts</h4>
                          {task.artifacts.map(a => (
                            <div key={a.artifactId} className="artifact">
                              <strong>{a.name}</strong>
                              {a.parts.map((p, i) => (
                                <pre key={i}>{p.text}</pre>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {task.history && task.history.length > 0 && (
                        <div className="task-history">
                          <h4>History ({task.history.length} messages)</h4>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
