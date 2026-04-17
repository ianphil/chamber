import { describe, it, expect } from 'vitest';
import {
  MindIdentitySchema,
  MindContextSchema,
  MindRecordSchema,
  MindAddArgs,
  MindRemoveArgs,
  MindListArgs,
  MindSetActiveArgs,
  MindSelectDirectoryArgs,
  MindOpenWindowArgs,
} from './mind';

describe('mind contract', () => {
  it('MindIdentity requires name + systemMessage', () => {
    expect(MindIdentitySchema.safeParse({ name: 'Aria', systemMessage: 'you are...' }).success).toBe(true);
    expect(MindIdentitySchema.safeParse({ name: 'Aria' }).success).toBe(false);
  });

  it('MindContext accepts valid payload and rejects bad status', () => {
    const ok = MindContextSchema.safeParse({
      mindId: 'm1',
      mindPath: '/tmp/m1',
      identity: { name: 'Aria', systemMessage: '' },
      status: 'ready',
    });
    expect(ok.success).toBe(true);
    expect(
      MindContextSchema.safeParse({
        mindId: 'm1',
        mindPath: '/tmp',
        identity: { name: 'a', systemMessage: '' },
        status: 'bogus',
      }).success,
    ).toBe(false);
  });

  it('MindRecord requires id + path', () => {
    expect(MindRecordSchema.safeParse({ id: 'm1', path: '/tmp' }).success).toBe(true);
    expect(MindRecordSchema.safeParse({ id: '', path: '/tmp' }).success).toBe(false);
  });

  it.each([
    ['mind:add', MindAddArgs, ['/tmp/x'], ['']],
    ['mind:remove', MindRemoveArgs, ['m1'], ['']],
    ['mind:setActive', MindSetActiveArgs, ['m1'], [42]],
    ['mind:openWindow', MindOpenWindowArgs, ['m1'], []],
  ] as const)('%s args accept valid and reject invalid', (_channel, schema, good, bad) => {
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it('MindListArgs and MindSelectDirectoryArgs accept empty tuple only', () => {
    expect(MindListArgs.safeParse([]).success).toBe(true);
    expect(MindListArgs.safeParse(['x']).success).toBe(false);
    expect(MindSelectDirectoryArgs.safeParse([]).success).toBe(true);
    expect(MindSelectDirectoryArgs.safeParse(['x']).success).toBe(false);
  });
});
