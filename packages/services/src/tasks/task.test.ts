import { describe, expect, it } from 'vitest';
import { Task, TaskResult, TaskStatus, TaskType } from './index';

function bash(title = 'Example', payload = 'echo hi'): Task {
  return new Task({ title, payload, type: TaskType.Bash });
}

function taskWithStatus(status: TaskStatus): Task {
  const task = bash();
  switch (status) {
    case TaskStatus.Pending:
      return task;
    case TaskStatus.Running:
      task.transitionTo(TaskStatus.Running);
      return task;
    case TaskStatus.Done:
      task.transitionTo(TaskStatus.Running);
      task.transitionTo(TaskStatus.Done);
      return task;
    case TaskStatus.Failed:
      task.transitionTo(TaskStatus.Running);
      task.transitionTo(TaskStatus.Failed, 'boom');
      return task;
    case TaskStatus.Cancelled:
      task.cancel();
      return task;
  }
}

describe('Task', () => {
  it('test_type_must_be_task_type', () => {
    expect(() => new Task({ title: 'Example', payload: 'echo hi', type: 'not-a-task-type' as TaskType })).toThrow('type must be a TaskType');
  });

  it('test_timeout_must_be_positive', () => {
    expect(() => new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash, timeout: 0 })).toThrow('timeout must be greater than 0');
    expect(() => new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash, timeout: -1 })).toThrow('timeout must be greater than 0');
  });

  it('test_repr_includes_identity_title_and_status', () => {
    const task = bash();
    expect(task.toString()).toBe(`Task(id='${task.id}', title='Example', status=${TaskStatus.Pending})`);
  });

  it('test_timeout_defaults_to_no_automatic_timeout', () => {
    expect(bash().timeout).toBeNull();
  });

  it('test_timeout_accepts_positive_values', () => {
    const task = new Task({ title: 'Timeout', payload: 'echo hi', type: TaskType.Bash, timeout: 1.5 });
    expect(task.timeout).toBe(1.5);
  });

  it('test_id_is_read_only', () => {
    const task = bash();
    const originalId = task.id;
    expect(() => { task.id = 'new-id'; }).toThrow();
    expect(task.id).toBe(originalId);
  });

  it('test_status_is_read_only', () => {
    const task = bash();
    expect(() => { task.status = TaskStatus.Done; }).toThrow();
    expect(task.status).toBe(TaskStatus.Pending);
  });

  it('test_can_transition_to_rejects_non_task_status', () => {
    expect(() => bash().canTransitionTo('not-a-status' as TaskStatus)).toThrow('status must be a TaskStatus');
  });

  it('test_transition_to_rejects_non_task_status', () => {
    const task = bash();
    expect(() => task.transitionTo('not-a-status' as TaskStatus)).toThrow('status must be a TaskStatus');
    expect(task.status).toBe(TaskStatus.Pending);
  });

  it('test_status_changes_through_transition_to', () => {
    const task = bash();
    task.transitionTo(TaskStatus.Running);
    task.transitionTo(TaskStatus.Done);
    expect(task.status).toBe(TaskStatus.Done);
    expect(task.error).toBeNull();
  });

  it('test_cancel_changes_status_through_state_machine', () => {
    const task = bash();
    task.cancel();
    expect(task.status).toBe(TaskStatus.Cancelled);
  });

  it('test_cancel_is_idempotent', () => {
    const task = bash();
    task.cancel();
    task.cancel();
    expect(task.status).toBe(TaskStatus.Cancelled);
  });

  it('test_cancel_preserves_previous_error', () => {
    const task = bash();
    task.transitionTo(TaskStatus.Running);
    task.transitionTo(TaskStatus.Failed, 'boom');
    task.cancel();
    task.cancel();
    expect(task.status).toBe(TaskStatus.Cancelled);
    expect(task.error).toBe('boom');
  });

  it('test_done_tasks_reject_public_field_mutation', () => {
    const fields = [
      (task: Task) => { task.title = 'Changed'; },
      (task: Task) => { task.description = 'Changed'; },
      (task: Task) => { task.payload = 'echo changed'; },
      (task: Task) => { task.timeout = 1; },
      (task: Task) => { task.error = 'changed'; },
      (task: Task) => { task.result = new TaskResult({ taskId: 'replacement', status: TaskStatus.Done, startedAt: new Date(), finishedAt: new Date(), duration: 0 }); },
    ];
    for (const mutate of fields) {
      const task = bash();
      task.transitionTo(TaskStatus.Running);
      task.transitionTo(TaskStatus.Done);
      expect(() => mutate(task)).toThrow('DONE tasks are immutable');
    }
  });

  it('test_invalid_transition_preserves_error', () => {
    const task = bash();
    task.transitionTo(TaskStatus.Running);
    task.transitionTo(TaskStatus.Failed, 'boom');
    expect(() => task.transitionTo(TaskStatus.Done)).toThrow();
    expect(task.status).toBe(TaskStatus.Failed);
    expect(task.error).toBe('boom');
  });

  it('test_failed_tasks_remain_mutable_for_retry', () => {
    const task = bash('Example', 'exit 1');
    task.transitionTo(TaskStatus.Running);
    task.transitionTo(TaskStatus.Failed, 'boom');
    task.payload = 'echo recovered';
    task.error = null;
    expect(task.payload).toBe('echo recovered');
    expect(task.error).toBeNull();
  });

  it('test_allowed_transitions', () => {
    const allowed: Array<[TaskStatus, TaskStatus]> = [
      [TaskStatus.Pending, TaskStatus.Running],
      [TaskStatus.Pending, TaskStatus.Cancelled],
      [TaskStatus.Running, TaskStatus.Done],
      [TaskStatus.Running, TaskStatus.Failed],
      [TaskStatus.Running, TaskStatus.Cancelled],
      [TaskStatus.Failed, TaskStatus.Running],
      [TaskStatus.Failed, TaskStatus.Cancelled],
    ];
    for (const [initial, next] of allowed) {
      const task = taskWithStatus(initial);
      task.transitionTo(next);
      expect(task.status).toBe(next);
    }
  });

  it('test_disallowed_transitions_are_rejected', () => {
    const allowed = new Set([
      `${TaskStatus.Pending}:${TaskStatus.Running}`,
      `${TaskStatus.Pending}:${TaskStatus.Cancelled}`,
      `${TaskStatus.Running}:${TaskStatus.Done}`,
      `${TaskStatus.Running}:${TaskStatus.Failed}`,
      `${TaskStatus.Running}:${TaskStatus.Cancelled}`,
      `${TaskStatus.Failed}:${TaskStatus.Running}`,
      `${TaskStatus.Failed}:${TaskStatus.Cancelled}`,
    ]);
    for (const initial of Object.values(TaskStatus)) {
      for (const next of Object.values(TaskStatus)) {
        if (allowed.has(`${initial}:${next}`)) continue;
        const task = taskWithStatus(initial);
        expect(() => task.transitionTo(next)).toThrow(`Cannot transition task from '${initial}' to '${next}'`);
        expect(task.status).toBe(initial);
      }
    }
  });
});
