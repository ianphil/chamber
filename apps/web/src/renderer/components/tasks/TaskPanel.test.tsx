/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskPanel } from './TaskPanel';
import type { Task } from '@chamber/shared/a2a-types';

function makeTask(overrides: Partial<Task> & { id: string; contextId: string }): Task {
  return {
    status: { state: 'working' },
    ...overrides,
  };
}

const workingTask = makeTask({ id: 'task-1', contextId: 'ctx-1', status: { state: 'working' } });
const completedTask = makeTask({
  id: 'task-2',
  contextId: 'ctx-2',
  status: { state: 'completed' },
  artifacts: [
    { artifactId: 'a1', name: 'Result', parts: [{ text: 'Hello from agent' }] },
  ],
});
const failedTask = makeTask({ id: 'task-3', contextId: 'ctx-3', status: { state: 'failed' } });
const inputRequiredTask = makeTask({ id: 'task-4', contextId: 'ctx-4', status: { state: 'input-required' } });

describe('TaskPanel', () => {
  it('renders task list grouped by agent', () => {
    render(
      <TaskPanel
        tasksByMind={{ mind1: [workingTask], mind2: [completedTask] }}
        mindNames={{ mind1: 'Agent Alpha', mind2: 'Agent Beta' }}
      />,
    );
    expect(screen.getByText('Agent Alpha')).toBeTruthy();
    expect(screen.getByText('Agent Beta')).toBeTruthy();
  });

  it('shows correct status badge colors per state', () => {
    render(
      <TaskPanel
        tasksByMind={{
          m1: [workingTask],
          m2: [completedTask],
          m3: [failedTask],
          m4: [inputRequiredTask],
        }}
        mindNames={{}}
      />,
    );

    const workingBadge = screen.getByTestId('status-badge-task-1');
    expect(workingBadge.style.backgroundColor).toBe('rgb(59, 130, 246)'); // blue
    expect(workingBadge.textContent).toBe('working');

    const completedBadge = screen.getByTestId('status-badge-task-2');
    expect(completedBadge.style.backgroundColor).toBe('rgb(34, 197, 94)'); // green

    const failedBadge = screen.getByTestId('status-badge-task-3');
    expect(failedBadge.style.backgroundColor).toBe('rgb(239, 68, 68)'); // red

    const inputBadge = screen.getByTestId('status-badge-task-4');
    expect(inputBadge.style.backgroundColor).toBe('rgb(234, 179, 8)'); // yellow
  });

  it('click task expands details', () => {
    render(
      <TaskPanel tasksByMind={{ m1: [workingTask] }} mindNames={{}} />,
    );

    expect(screen.queryByTestId('details-task-1')).toBeNull();
    fireEvent.click(screen.getByText('task-1'));
    expect(screen.getByTestId('details-task-1')).toBeTruthy();
  });

  it('shows artifacts when present', () => {
    render(
      <TaskPanel tasksByMind={{ m1: [completedTask] }} mindNames={{}} />,
    );

    // expand the task
    fireEvent.click(screen.getByText('task-2'));
    expect(screen.getByTestId('artifacts-task-2')).toBeTruthy();
    expect(screen.getByText('Result')).toBeTruthy();
    expect(screen.getByText('Hello from agent')).toBeTruthy();
  });

  it('cancel button calls onCancelTask', () => {
    const onCancel = vi.fn();
    render(
      <TaskPanel
        tasksByMind={{ m1: [workingTask] }}
        mindNames={{}}
        onCancelTask={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId('cancel-btn-task-1'));
    expect(onCancel).toHaveBeenCalledWith('task-1');
  });

  it('no cancel button on terminal tasks', () => {
    render(
      <TaskPanel
        tasksByMind={{ m1: [completedTask, failedTask] }}
        mindNames={{}}
        onCancelTask={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('cancel-btn-task-2')).toBeNull();
    expect(screen.queryByTestId('cancel-btn-task-3')).toBeNull();
  });
});
