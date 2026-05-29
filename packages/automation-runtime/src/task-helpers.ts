import { Task, type TaskInit } from '@ianphil/ttasks-ts';
import type { HttpTaskInput } from './handlers/http';

/**
 * Ergonomic factory for `http` tasks.
 *
 * Scripts: `import { Task, httpTask } from '@chamber/automation-runtime/task-helpers'`
 * Then use `httpTask({ url: '...', method: 'POST', body: {...} })` like `Task.bash(...)`.
 */
export function httpTask(input: HttpTaskInput, init?: TaskInit): Task {
  return Task.custom('http', JSON.stringify(input), {
    title: init?.title ?? `http ${input.method ?? 'GET'} ${input.url}`,
    ...init,
  });
}
