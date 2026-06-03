import { TaskExecutor } from '@ianphil/ttasks-ts';
import { a2aHandler } from './handlers/a2a';
import { httpHandler } from './handlers/http';
import { notifyHandler } from './handlers/notify';
import { promptHandler } from './handlers/prompt';

/** Register all built-in Chamber ttasks handlers on an executor. */
export function registerChamberHandlers(executor: TaskExecutor): void {
  executor.register('chamber:prompt', promptHandler);
  executor.register('chamber:notify', notifyHandler);
  executor.register('chamber:a2a', a2aHandler);
  executor.register('http', httpHandler);
}
