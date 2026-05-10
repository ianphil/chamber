import React, { useState } from 'react';
import type { Task, TaskState } from '@chamber/shared/a2a-types';

export interface TaskPanelProps {
  tasksByMind: Record<string, Task[]>;
  mindNames: Record<string, string>;
  onCancelTask?: (taskId: string) => void;
}

const STATUS_COLORS: Record<TaskState, string> = {
  submitted: '#6b7280',
  working: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  canceled: '#6b7280',
  'input-required': '#eab308',
  rejected: '#ef4444',
  'auth-required': '#eab308',
};

const TERMINAL_STATES: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];

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
                      {task.status.state}
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
