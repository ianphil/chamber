import { Task, type TaskInit } from '@ianphil/ttasks-ts';
import type { HttpTaskInput } from './handlers/http';

/**
 * Ergonomic factory for `http` tasks.
 *
 * Scripts import `Task` directly from `@ianphil/ttasks-ts` and `httpTask`
 * from `@chamber/automation-runtime`, then register `httpHandler` on their
 * executor.
 */
export function httpTask(input: HttpTaskInput, init?: TaskInit): Task {
  return Task.custom('http', JSON.stringify(input), {
    title: init?.title ?? `http ${input.method ?? 'GET'} ${input.url}`,
    ...init,
  });
}
