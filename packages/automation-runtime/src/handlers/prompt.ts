import { Task, TaskStatus, type TaskHandler, type TaskInit } from '@ianphil/ttasks-ts';
import { bridgeRequest } from '../bridge-client';

export interface ChamberPromptInput {
  prompt: string;
  recipient?: string;
}

export interface ChamberPromptOutput {
  text: string;
}

/** Factory: build a `chamber:prompt` task to add to a ttasks graph. */
export function chamberPrompt(input: ChamberPromptInput, init?: TaskInit): Task {
  return Task.custom('chamber:prompt', JSON.stringify(input), {
    title: init?.title ?? 'chamber:prompt',
    ...init,
  });
}

/** Handler: register on a TaskExecutor to run `chamber:prompt` tasks. */
export const promptHandler: TaskHandler = async (context) => {
  const input = JSON.parse(context.payload) as ChamberPromptInput;
  const result = await bridgeRequest<ChamberPromptOutput>('/prompt', {
    prompt: input.prompt,
    ...(input.recipient ? { recipient: input.recipient } : {}),
  });
  return {
    status: TaskStatus.SUCCEEDED,
    output: result.text,
    raw: result,
  };
};
