/**
 * Type-level contract for the renderer-facing `ElectronAPI` surface.
 *
 * The `ElectronAPI` interface itself is the single source of truth for what
 * preload exposes via `contextBridge.exposeInMainWorld('electronAPI', ...)`,
 * so this test pins the shape and the global `window.electronAPI` typing.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ElectronAPI } from './electron-types';

describe('ElectronAPI contract', () => {
  it('exposes the major namespaces with the expected method shapes', () => {
    expectTypeOf<ElectronAPI['chat']['send']>().toBeFunction();
    expectTypeOf<ElectronAPI['chat']['stop']>().toBeFunction();
    expectTypeOf<ElectronAPI['chat']['onEvent']>().toBeFunction();

    expectTypeOf<ElectronAPI['mind']['list']>().toBeFunction();
    expectTypeOf<ElectronAPI['mind']['onMindChanged']>().toBeFunction();

    expectTypeOf<ElectronAPI['lens']['getViews']>().toBeFunction();
    expectTypeOf<ElectronAPI['lens']['onViewsChanged']>().toBeFunction();

    expectTypeOf<ElectronAPI['auth']['startLogin']>().toBeFunction();
    expectTypeOf<ElectronAPI['auth']['onProgress']>().toBeFunction();

    expectTypeOf<ElectronAPI['chatroom']['send']>().toBeFunction();
    expectTypeOf<ElectronAPI['chatroom']['onEvent']>().toBeFunction();

    expectTypeOf<ElectronAPI['updater']['getState']>().toBeFunction();
    expectTypeOf<ElectronAPI['a2a']['listAgents']>().toBeFunction();
    expectTypeOf<ElectronAPI['a2a']['relayStatus']>().toBeFunction();
    expectTypeOf<ElectronAPI['a2a']['relayConnect']>().toBeFunction();
    expectTypeOf<ElectronAPI['a2a']['relayDisconnect']>().toBeFunction();
    expectTypeOf<ElectronAPI['a2a']['onRelayStateChanged']>().toBeFunction();
  });

  it('declares window.electronAPI as ElectronAPI globally', () => {
    expectTypeOf<Window['electronAPI']>().toEqualTypeOf<ElectronAPI>();
  });

  it('back-compat re-export is intentionally removed; ElectronAPI now lives only in electron-types', async () => {
    // The legacy import path (`@chamber/shared/types`) intentionally no longer
    // re-exports `ElectronAPI` so there is one source of truth and no risk of
    // a circular runtime dependency between the two modules.
    const sharedTypes = await import('./types');
    expect(Object.prototype.hasOwnProperty.call(sharedTypes, 'ElectronAPI')).toBe(false);
  });
});
