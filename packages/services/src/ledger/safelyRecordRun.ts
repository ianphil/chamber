import type { LedgerRecord } from '@chamber/shared';
import { Logger } from '../logger';
import type { CompleteInput, CreateRunningInput, FinalizeInput, LedgerWriter } from './LedgerWriter';

const log = Logger.create('safelyRecordRun');

export type RunLifecycleWriter =
  Pick<LedgerWriter, 'createRunning' | 'complete' | 'fail'>
  & { finalize?: LedgerWriter['finalize'] };

export async function safelyRecordRun<T>(
  writer: RunLifecycleWriter,
  input: CreateRunningInput,
  work: (task: LedgerRecord | undefined) => Promise<T>,
  completeInput: CompleteInput = {},
  finalizeResult?: (result: T) => FinalizeInput,
): Promise<T> {
  let task: LedgerRecord | undefined;
  try {
    task = writer.createRunning(input);
  } catch (err) {
    log.warn('Failed to create ledger run record; continuing producer work:', err);
  }

  try {
    const result = await work(task);
    if (task) {
      try {
        const finalizeInput = finalizeResult?.(result);
        if (finalizeInput && writer.finalize) {
          writer.finalize(task.ledgerId, finalizeInput);
        } else {
          writer.complete(task.ledgerId, completeInput);
        }
      } catch (err) {
        log.warn('Failed to complete ledger run record:', err);
      }
    }
    return result;
  } catch (err) {
    if (task) {
      try {
        writer.fail(task.ledgerId, err instanceof Error ? err : String(err));
      } catch (ledgerErr) {
        log.warn('Failed to mark ledger run record failed:', ledgerErr);
      }
    }
    throw err;
  }
}
