import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseIpcArgs } from './ipc-validation';
import { IPC } from './ipc-channels';

describe('parseIpcArgs', () => {
  it('returns the parsed value when the payload matches the schema', () => {
    const schema = z.object({ name: z.string(), count: z.number().int() });

    const result = parseIpcArgs(IPC.CHATROOM.SEND, schema, { name: 'lucy', count: 3 });

    expect(result).toEqual({ name: 'lucy', count: 3 });
  });

  it('throws TypeError prefixed with the channel name on a single failure', () => {
    const schema = z.object({ name: z.string() });

    expect(() => parseIpcArgs(IPC.CHATROOM.SEND, schema, { name: 42 })).toThrow(TypeError);
    try {
      parseIpcArgs(IPC.CHATROOM.SEND, schema, { name: 42 });
    } catch (err) {
      expect((err as TypeError).message).toContain('chatroom:send');
      expect((err as TypeError).message).toContain('name');
    }
  });

  it('aggregates every Zod issue into the thrown TypeError message', () => {
    const schema = z.object({ name: z.string(), count: z.number().int() });

    try {
      parseIpcArgs(IPC.GENESIS.CREATE_FROM_TEMPLATE, schema, { name: 42, count: 'three' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      const message = (err as TypeError).message;
      expect(message).toContain('genesis:createFromTemplate');
      expect(message).toContain('name');
      expect(message).toContain('count');
    }
  });

  it('marks issues with empty paths as "<payload>" so top-level errors are legible', () => {
    const schema = z.string();

    try {
      parseIpcArgs(IPC.CHATROOM.STOP, schema, 42);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TypeError).message).toContain('<payload>');
    }
  });
});
