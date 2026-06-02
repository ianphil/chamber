import { Task, type TaskHandler, type TaskInit } from '@ianphil/ttasks-ts';
import { bridgeRequest } from '../bridge-client';

export interface ChamberNotifyInput {
  title: string;
  body: string;
}

export interface ChamberNotifyOutput {
  ok: true;
}

export function chamberNotify(input: ChamberNotifyInput, init?: TaskInit): Task {
  return Task.custom('chamber:notify', JSON.stringify(input), {
    title: init?.title ?? 'chamber:notify',
    ...init,
  });
}

export const notifyHandler: TaskHandler = async (context) => {
  const input = JSON.parse(context.payload) as ChamberNotifyInput;
  await bridgeRequest<ChamberNotifyOutput>('/notify', {
    title: input.title,
    body: input.body,
  });
  // Return a bare string so the ttasks executor records it as result.output;
  // returning a `{ status, output }` object normalizes to an EMPTY output.
  return 'notification fired';
};
