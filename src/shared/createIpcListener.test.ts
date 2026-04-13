import { describe, it, expect, vi } from 'vitest';
import { createIpcListener } from './createIpcListener';
import type { IpcRenderer, IpcRendererEvent } from 'electron';

function makeMockIpcRenderer() {
  const listeners = new Map<string, Function[]>();
  return {
    on: vi.fn((channel: string, handler: Function) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      const list = listeners.get(channel);
      if (!list) throw new Error('expected listener list');
      list.push(handler);
    }),
    removeListener: vi.fn((channel: string, handler: Function) => {
      const arr = listeners.get(channel);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }),
    // Helper to simulate an event
    _emit(channel: string, ...args: unknown[]) {
      const fakeEvent = {} as IpcRendererEvent;
      for (const fn of listeners.get(channel) || []) {
        fn(fakeEvent, ...args);
      }
    },
  } as unknown as IpcRenderer & { _emit: (channel: string, ...args: unknown[]) => void };
}

describe('createIpcListener', () => {
  it('registers a listener on the given channel', () => {
    const ipc = makeMockIpcRenderer();
    const callback = vi.fn();

    createIpcListener(ipc, 'test-channel', callback);

    expect(ipc.on).toHaveBeenCalledWith('test-channel', expect.any(Function));
  });

  it('forwards IPC events to the callback without the event object', () => {
    const ipc = makeMockIpcRenderer();
    const callback = vi.fn();

    createIpcListener(ipc, 'chat:event', callback);
    ipc._emit('chat:event', 'msg-1', { type: 'chunk', content: 'hi' });

    expect(callback).toHaveBeenCalledWith('msg-1', { type: 'chunk', content: 'hi' });
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const ipc = makeMockIpcRenderer();
    const callback = vi.fn();

    const unsub = createIpcListener(ipc, 'my-channel', callback);
    unsub();

    expect(ipc.removeListener).toHaveBeenCalledWith('my-channel', expect.any(Function));
  });

  it('stops receiving events after unsubscribe', () => {
    const ipc = makeMockIpcRenderer();
    const callback = vi.fn();

    const unsub = createIpcListener(ipc, 'data', callback);
    ipc._emit('data', 'first');
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();
    ipc._emit('data', 'second');
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
