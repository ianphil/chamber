import { describe, it, expectTypeOf } from 'vitest';
import type {
  CancelOutcome,
  DeliveryStatus,
  LedgerRecord,
  LedgerStatus,
  NotifyPolicy,
  RuntimePayload,
  ScopeKind,
  TaskRuntime,
} from './ledger';

describe('ledger shared types', () => {
  it('RuntimePayload has one variant for every TaskRuntime', () => {
    type MissingPayloadRuntime = Exclude<TaskRuntime, RuntimePayload['runtime']>;
    type AssertNever<T extends never> = T;
    expectTypeOf<AssertNever<MissingPayloadRuntime>>().toEqualTypeOf<never>();
  });

  it('LedgerStatus covers the full task lifecycle vocabulary', () => {
    type ExpectedLedgerStatus =
      | 'queued'
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'timed-out'
      | 'cancelled'
      | 'lost';
    type MissingLedgerStatus = Exclude<ExpectedLedgerStatus, LedgerStatus>;
    type AssertNever<T extends never> = T;
    expectTypeOf<AssertNever<MissingLedgerStatus>>().toEqualTypeOf<never>();
  });

  it('LedgerRecord exposes the pure IPC-safe record shape', () => {
    expectTypeOf<LedgerRecord['ledgerId']>().toBeString();
    expectTypeOf<LedgerRecord['runtime']>().toEqualTypeOf<TaskRuntime>();
    expectTypeOf<LedgerRecord['scopeKind']>().toEqualTypeOf<ScopeKind>();
    expectTypeOf<LedgerRecord['status']>().toEqualTypeOf<LedgerStatus>();
    expectTypeOf<LedgerRecord['notifyPolicy']>().toEqualTypeOf<NotifyPolicy>();
    expectTypeOf<LedgerRecord['deliveryStatus']>().toEqualTypeOf<DeliveryStatus>();
    expectTypeOf<LedgerRecord['payload']>().toEqualTypeOf<RuntimePayload>();
  });

  it('CancelOutcome returns an optional ledger record', () => {
    expectTypeOf<CancelOutcome['found']>().toBeBoolean();
    expectTypeOf<CancelOutcome['cancelled']>().toBeBoolean();
    expectTypeOf<CancelOutcome['task']>().toEqualTypeOf<LedgerRecord | undefined>();
  });
});
