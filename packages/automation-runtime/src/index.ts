/**
 * Chamber automation runtime helpers.
 *
 * Scripts under `.chamber/automation/` import from this package when they
 * want to use Chamber-side capabilities (the bridge to the SDK runtime and
 * the OS notification surface) inside a ttasks graph.
 *
 * Plain tasks, graphs, executors, stores, and retry policies are imported
 * directly from `@ianphil/ttasks-ts`.
 */
export { bridgeRequest, BridgeUnconfiguredError, BridgeError } from './bridge-client';
export { promptHandler, chamberPrompt } from './handlers/prompt';
export { notifyHandler, chamberNotify } from './handlers/notify';
export { a2aHandler, chamberA2A } from './handlers/a2a';
export { httpHandler } from './handlers/http';
export { registerChamberHandlers } from './registerHandlers';
export { httpTask } from './task-helpers';
export type { ChamberPromptInput, ChamberPromptOutput } from './handlers/prompt';
export type { ChamberNotifyInput, ChamberNotifyOutput } from './handlers/notify';
export type { HttpTaskInput } from './handlers/http';
