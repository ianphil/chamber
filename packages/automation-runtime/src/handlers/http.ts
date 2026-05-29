import { TaskStatus, type TaskHandler } from '@ianphil/ttasks-ts';

export interface HttpTaskInput {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Handler for `http` task type. Scripts produce these via:
 *   Task.custom('http', JSON.stringify({ url, method, headers, body }))
 *
 * A small `httpTask()` factory wraps that ergonomically.
 */
export const httpHandler: TaskHandler = async (context) => {
  const input = JSON.parse(context.payload) as HttpTaskInput;
  const init: RequestInit = {
    method: input.method ?? 'GET',
    signal: context.signal,
  };
  if (input.headers) {
    init.headers = input.headers;
  }
  if (input.body !== undefined) {
    init.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    init.headers = {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
  }
  const response = await fetch(input.url, init);
  const text = await response.text();
  if (!response.ok) {
    return {
      status: TaskStatus.FAILED,
      output: text,
      error: `HTTP ${response.status}`,
    };
  }
  return {
    status: TaskStatus.SUCCEEDED,
    output: text,
  };
};
