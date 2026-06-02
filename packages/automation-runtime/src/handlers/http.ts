import { type TaskHandler } from '@ianphil/ttasks-ts';

export interface HttpTaskInput {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

const ERROR_BODY_PREVIEW_MAX_CHARS = 500;

/**
 * Handler for `http` task type. Scripts produce these via:
 *   Task.custom('http', JSON.stringify({ url, method, headers, body }))
 *
 * A small `httpTask()` factory wraps that ergonomically.
 *
 * Returns the response body as a bare string on success so the ttasks executor
 * records it as `result.output`. On a non-2xx response it THROWS: the executor
 * only marks a task FAILED when the handler throws, so returning a
 * `{ status: FAILED }` object would be silently treated as success with empty
 * output.
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
    const preview = text.length > ERROR_BODY_PREVIEW_MAX_CHARS
      ? `${text.slice(0, ERROR_BODY_PREVIEW_MAX_CHARS)}...[truncated ${text.length - ERROR_BODY_PREVIEW_MAX_CHARS} chars]`
      : text;
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${preview}`);
  }
  return text;
};
