import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TaskRuntime } from '@chamber/shared';
import type { RuntimeCancelHandlers } from './task-registry-control.runtime';
import { createEmptyRuntimeCancelHandlers } from './task-registry-control.runtime';

describe('task-registry-control.runtime', () => {
  it('starts with no producer cancellation handlers wired', () => {
    expect(createEmptyRuntimeCancelHandlers()).toEqual({});
  });

  it('keeps handler keys exhaustive over TaskRuntime', () => {
    expectTypeOf<keyof RuntimeCancelHandlers>().toEqualTypeOf<TaskRuntime>();
  });
});
