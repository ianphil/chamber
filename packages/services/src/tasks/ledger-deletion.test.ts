import { describe, expect, it } from 'vitest';
import { Task, TaskLedger, TaskStatus, TaskType } from './index';

function bash(): Task {
  return new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash });
}

describe('TaskLedger deletion', () => {
  it('test_del_removes_task_from_ledger', () => {
    const ledger = new TaskLedger();
    const task = bash();
    ledger.set(task.id, task);
    ledger.delete(task.id);
    expect(ledger.has(task.id)).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it('test_delete_missing_task_raises_key_error', () => {
    expect(() => new TaskLedger().delete('missing')).toThrow('KeyError: missing');
  });

  it('test_cancel_missing_task_raises_key_error', () => {
    expect(() => new TaskLedger().cancel('missing')).toThrow('KeyError: missing');
  });

  it('test_cancel_marks_task_cancelled_and_keeps_it_in_ledger', () => {
    const ledger = new TaskLedger();
    const task = bash();
    ledger.set(task.id, task);
    ledger.cancel(task.id);
    expect(ledger.has(task.id)).toBe(true);
    expect(ledger.size).toBe(1);
    expect(ledger.get(task.id)).toBe(task);
    expect(ledger.get(task.id).status).toBe(TaskStatus.Cancelled);
  });
});
