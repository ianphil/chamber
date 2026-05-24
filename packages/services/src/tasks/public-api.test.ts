import { describe, expect, it } from 'vitest';
import * as tasks from './index';
import { EventBus, TaskEventType } from './events';
import {
  TaskCancelled,
  TaskContext,
  TaskExecutionError,
  TaskExecutor,
  TaskTimeoutError,
  makeCopilotAgentHandler,
  makeCopilotPromptHandler,
  makeDefaultExecutor,
} from './executor';
import { GraphLedger, TaskLedger } from './ledger';
import { Task, TaskResult, TaskStatus, TaskType } from './task';
import { TaskGraph } from './workflow';

const expectedPublicNames = new Set([
  'EventBus',
  'GraphLedger',
  'Task',
  'TaskCancelled',
  'TaskContext',
  'TaskExecutionError',
  'TaskEventType',
  'TaskExecutor',
  'TaskGraph',
  'TaskLedger',
  'TaskResult',
  'TaskTimeoutError',
  'TaskStatus',
  'TaskType',
  'makeCopilotAgentHandler',
  'makeCopilotPromptHandler',
  'makeDefaultExecutor',
]);

describe('public API', () => {
  it('test_all_lists_every_public_name', () => {
    expect(new Set(tasks.publicNames)).toEqual(expectedPublicNames);
  });

  it('test_every_public_name_is_importable_from_top_level', () => {
    for (const name of tasks.publicNames) {
      expect(tasks).toHaveProperty(name);
    }
  });

  it('test_top_level_names_are_the_same_objects_as_submodule_names', () => {
    expect(tasks.EventBus).toBe(EventBus);
    expect(tasks.GraphLedger).toBe(GraphLedger);
    expect(tasks.Task).toBe(Task);
    expect(tasks.TaskStatus).toBe(TaskStatus);
    expect(tasks.TaskType).toBe(TaskType);
    expect(tasks.TaskResult).toBe(TaskResult);
    expect(tasks.TaskTimeoutError).toBe(TaskTimeoutError);
    expect(tasks.TaskLedger).toBe(TaskLedger);
    expect(tasks.TaskEventType).toBe(TaskEventType);
    expect(tasks.TaskExecutionError).toBe(TaskExecutionError);
    expect(tasks.TaskExecutor).toBe(TaskExecutor);
    expect(tasks.TaskContext).toBe(TaskContext);
    expect(tasks.TaskCancelled).toBe(TaskCancelled);
    expect(tasks.makeCopilotAgentHandler).toBe(makeCopilotAgentHandler);
    expect(tasks.makeCopilotPromptHandler).toBe(makeCopilotPromptHandler);
    expect(tasks.makeDefaultExecutor).toBe(makeDefaultExecutor);
    expect(tasks.TaskGraph).toBe(TaskGraph);
  });
});
