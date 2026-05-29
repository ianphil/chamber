/**
 * Chamber automation runtime helpers.
 *
 * Scripts under `.chamber/automation/` import from this package when they
 * want to use Chamber-side capabilities (the bridge to the SDK runtime and
 * the OS notification surface) inside a ttasks graph.
 *
 * Plain bash/http use `Task.bash()` / `Task.http()` directly from ttasks.
 */
export { bridgeRequest, BridgeUnconfiguredError, BridgeError } from './bridge-client';
export { promptHandler, chamberPrompt } from './handlers/prompt';
export { notifyHandler, chamberNotify } from './handlers/notify';
export { httpHandler } from './handlers/http';
export { httpTask } from './task-helpers';
export { runGraph } from './run';
export type { ChamberPromptInput, ChamberPromptOutput } from './handlers/prompt';
export type { ChamberNotifyInput, ChamberNotifyOutput } from './handlers/notify';
export type { HttpTaskInput } from './handlers/http';
export type { RunGraphOptions } from './run';
