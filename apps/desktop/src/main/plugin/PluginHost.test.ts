import { describe, it, expect, vi } from 'vitest';
import { PluginHost } from './PluginHost';
import type { ChamberMainPlugin, MainPluginContext, PluginLogLevel } from '@chamber/plugin-api';

function makeContext(): MainPluginContext {
  return {
    appVersion: '1.2.3',
    userDataPath: '/tmp/chamber',
    log: () => {},
  };
}

function makeLogger() {
  const entries: Array<{ level: PluginLogLevel; message: string }> = [];
  const log: (level: PluginLogLevel, message: string) => void = (level, message) => {
    entries.push({ level, message });
  };
  return { entries, log };
}

describe('PluginHost', () => {
  it('no-ops when no specifier is configured', async () => {
    const importModule = vi.fn();
    const { log, entries } = makeLogger();
    const host = new PluginHost(importModule, log);

    const result = await host.load(undefined, makeContext());

    expect(result).toBeNull();
    expect(importModule).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('treats a blank specifier as unconfigured', async () => {
    const importModule = vi.fn();
    const host = new PluginHost(importModule, () => {});

    expect(await host.load('   ', makeContext())).toBeNull();
    expect(importModule).not.toHaveBeenCalled();
  });

  it('loads a default-exported plugin and invokes registerMain once with the context', async () => {
    const registerMain = vi.fn();
    const plugin: ChamberMainPlugin = { id: 'fake-enterprise', registerMain };
    const importModule = vi.fn(async () => ({ default: plugin }));
    const host = new PluginHost(importModule, () => {});
    const context = makeContext();

    const result = await host.load('@genesis/chamber-enterprise', context);

    expect(importModule).toHaveBeenCalledWith('@genesis/chamber-enterprise');
    expect(registerMain).toHaveBeenCalledTimes(1);
    expect(registerMain).toHaveBeenCalledWith(context);
    expect(result).toBe(plugin);
  });

  it('accepts a plugin exported as the module namespace itself', async () => {
    const registerMain = vi.fn();
    const plugin: ChamberMainPlugin = { id: 'ns-plugin', registerMain };
    const host = new PluginHost(async () => plugin, () => {});

    expect(await host.load('pkg', makeContext())).toBe(plugin);
    expect(registerMain).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows when the module is not a valid plugin', async () => {
    const { log, entries } = makeLogger();
    const host = new PluginHost(async () => ({ default: { id: 'oops' } }), log);

    const result = await host.load('bad', makeContext());

    expect(result).toBeNull();
    expect(entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('logs and swallows when the import throws so boot is not blocked', async () => {
    const { log, entries } = makeLogger();
    const host = new PluginHost(async () => {
      throw new Error('module not found');
    }, log);

    const result = await host.load('missing', makeContext());

    expect(result).toBeNull();
    expect(entries.some((e) => e.level === 'error')).toBe(true);
  });

  it('logs and swallows when registerMain rejects', async () => {
    const { log, entries } = makeLogger();
    const plugin: ChamberMainPlugin = { id: 'throws', registerMain: () => Promise.reject(new Error('boom')) };
    const host = new PluginHost(async () => ({ default: plugin }), log);

    const result = await host.load('throws', makeContext());

    expect(result).toBeNull();
    expect(entries.some((e) => e.level === 'error')).toBe(true);
  });
});
