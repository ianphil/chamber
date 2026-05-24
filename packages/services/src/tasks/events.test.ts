import { describe, expect, it } from 'vitest';
import { EventBus, Task, TaskEvent, TaskEventType, TaskStatus, TaskType } from './index';

function event(task: Task, type: TaskEventType): TaskEvent {
  return {
    type,
    taskId: task.id,
    task,
    timestamp: new Date(),
    previousStatus: TaskStatus.Pending,
    status: task.status,
  };
}

describe('EventBus', () => {
  it('test_event_bus_subscribe_receives_emitted_event', () => {
    const bus = new EventBus();
    const task = new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash });
    const e = event(task, TaskEventType.Started);
    const seen: TaskEvent[] = [];
    bus.subscribe((item) => seen.push(item));
    bus.emit(e);
    expect(seen).toEqual([e]);
  });

  it('test_event_bus_unsubscribe_stops_future_events', () => {
    const bus = new EventBus();
    const task = new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash });
    const e = event(task, TaskEventType.Started);
    const seen: TaskEvent[] = [];
    const unsubscribe = bus.subscribe((item) => seen.push(item));
    unsubscribe();
    bus.emit(e);
    expect(seen).toEqual([]);
  });

  it('test_event_bus_rejects_non_callable_subscribers', () => {
    const bus = new EventBus();
    expect(() => bus.subscribe('not callable' as never)).toThrow('subscriber must be callable');
  });

  it('test_event_bus_records_subscriber_errors_without_stopping_emit', () => {
    const bus = new EventBus();
    const task = new Task({ title: 'Example', payload: 'echo hi', type: TaskType.Bash });
    const e = event(task, TaskEventType.Started);
    const seen: TaskEvent[] = [];
    bus.subscribe(() => { throw new Error('observer failed'); });
    bus.subscribe((item) => seen.push(item));
    bus.emit(e);
    expect(seen).toEqual([e]);
    expect(bus.errors).toHaveLength(1);
    expect(bus.errors[0]).toBeInstanceOf(Error);
    expect((bus.errors[0] as Error).message).toBe('observer failed');
    expect(bus.errors).not.toBe(bus.errors);
  });
});
