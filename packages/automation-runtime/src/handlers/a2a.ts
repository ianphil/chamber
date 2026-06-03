import { Task, type TaskHandler, type TaskInit } from '@ianphil/ttasks-ts';
import { bridgeRequest } from '../bridge-client';

export interface ChamberA2AInput {
  recipient: string;
  message: string;
  contextId?: string;
  referenceTaskIds?: string[];
}

export interface ChamberA2AOutput {
  id: string;
  contextId?: string;
  status?: string;
  [key: string]: unknown;
}

/** Factory: build a `chamber:a2a` task to add to a ttasks graph. */
export function chamberA2A(input: ChamberA2AInput, init?: TaskInit): Task {
  return Task.custom('chamber:a2a', JSON.stringify(input), {
    title: init?.title ?? 'chamber:a2a',
    ...init,
  });
}

/** Handler: register on a TaskExecutor to run `chamber:a2a` tasks. */
export const a2aHandler: TaskHandler = async (context) => {
  const input = JSON.parse(context.payload) as ChamberA2AInput;
  const result = await bridgeRequest<ChamberA2AOutput>('/a2a', {
    recipient: input.recipient,
    message: input.message,
    ...(input.contextId ? { contextId: input.contextId } : {}),
    ...(input.referenceTaskIds ? { referenceTaskIds: input.referenceTaskIds } : {}),
  });
  // Return a JSON string so the ttasks executor records the A2A task snapshot
  // as durable output text for downstream inspection.
  return JSON.stringify(result);
};
