import { describe, expect, it } from 'vitest';
import { Task, TaskLedger, TaskType } from './index';

function bash(title = 'Example'): Task {
  return new Task({ title, payload: 'echo hi', type: TaskType.Bash });
}

describe('TaskLedger', () => {
  it('test_ledger_rejects_non_task_values', () => {
    const ledger = new TaskLedger();
    expect(() => ledger.set('id', 'not a task' as never)).toThrow('Expected Task, got string');
    expect(ledger.has('id')).toBe(false);
  });

  it('test_ledger_rejects_task_id_mismatch', () => {
    const ledger = new TaskLedger();
    const task = bash();
    expect(() => ledger.set('wrong-id', task)).toThrow('task_id must match task.id');
    expect(ledger.has('wrong-id')).toBe(false);
    expect(ledger.has(task.id)).toBe(false);
  });

  it('test_iterates_over_tasks_in_insertion_order', () => {
    const ledger = new TaskLedger();
    const first = bash('First');
    const second = bash('Second');
    ledger.set(first.id, first);
    ledger.set(second.id, second);
    expect([...ledger]).toEqual([first, second]);
  });

  it('test_repr_includes_task_count', () => {
    expect(new TaskLedger().toString()).toBe('TaskLedger(0 tasks)');
  });

  it('test_get_missing_task_raises_key_error', () => {
    expect(() => new TaskLedger().get('missing')).toThrow('KeyError: missing');
  });

  it('test_task_id_cannot_change_after_storing_in_ledger', () => {
    const ledger = new TaskLedger();
    const task = bash();
    const id = task.id;
    ledger.set(id, task);
    expect(() => { task.id = 'new-id'; }).toThrow();
    expect(task.id).toBe(id);
    expect(ledger.get(id)).toBe(task);
  });

  it('test_ledger_accepts_task_under_its_own_id', () => {
    const ledger = new TaskLedger();
    const task = bash();
    ledger.set(task.id, task);
    expect(ledger.has(task.id)).toBe(true);
    expect(ledger.get(task.id)).toBe(task);
  });
});
