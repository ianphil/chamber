import { describe, expect, it, vi } from 'vitest';

import { createByoLlmModelsProvider } from './byoLlmModelsProvider';
import type { ByoLlmConfig, ByoLlmProbeResult } from '@chamber/shared/types';

function makeConfig(overrides: Partial<ByoLlmConfig> = {}): ByoLlmConfig {
  return {
    enabled: true,
    baseUrl: 'http://localhost:11434/v1',
    model: 'gemma4:e4b-it-q4_K_M',
    ...overrides,
  };
}

describe('createByoLlmModelsProvider', () => {
  it('BVT-P01: returns null when BYO is disabled', async () => {
    const provider = createByoLlmModelsProvider({
      getConfig: () => makeConfig({ enabled: false }),
      probe: vi.fn(),
    });
    expect(await provider()).toBeNull();
  });

  it('BVT-P02: returns null when no config is cached', async () => {
    const probe = vi.fn();
    const provider = createByoLlmModelsProvider({
      getConfig: () => null,
      probe,
    });
    expect(await provider()).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('BVT-P03: returns BYO models when probe succeeds', async () => {
    const provider = createByoLlmModelsProvider({
      getConfig: () => makeConfig(),
      probe: async (): Promise<ByoLlmProbeResult> => ({
        ok: true,
        modelCount: 2,
        models: [{ id: 'gpt-oss:20b' }, { id: 'gemma4:e4b-it-q4_K_M', name: 'gemma' }],
      }),
    });
    expect(await provider()).toEqual([
      { id: 'gpt-oss:20b', name: 'gpt-oss:20b', provider: 'byo' },
      { id: 'gemma4:e4b-it-q4_K_M', name: 'gemma', provider: 'byo' },
    ]);
  });

  it('BVT-P04: returns the saved model as a stub when probe fails so the selection survives', async () => {
    const onProbeError = vi.fn();
    const provider = createByoLlmModelsProvider({
      getConfig: () => makeConfig({ model: 'gemma4:e4b-it-q4_K_M' }),
      probe: async (): Promise<ByoLlmProbeResult> => ({ ok: false, error: 'endpoint unreachable' }),
      onProbeError,
    });
    const result = await provider();
    expect(result).toEqual([{ id: 'gemma4:e4b-it-q4_K_M', name: 'gemma4:e4b-it-q4_K_M', provider: 'byo' }]);
    expect(onProbeError).toHaveBeenCalledTimes(1);
  });

  it('BVT-P05: returns the saved model as a stub when probe throws', async () => {
    const provider = createByoLlmModelsProvider({
      getConfig: () => makeConfig({ model: 'phi4:14b' }),
      probe: async () => { throw new Error('network down'); },
    });
    expect(await provider()).toEqual([{ id: 'phi4:14b', name: 'phi4:14b', provider: 'byo' }]);
  });

  it('BVT-P06: returns [] (not null) when probe fails and no saved model so cloud fallback is still suppressed', async () => {
    const provider = createByoLlmModelsProvider({
      getConfig: () => makeConfig({ model: undefined }),
      probe: async (): Promise<ByoLlmProbeResult> => ({ ok: false, error: 'no models' }),
    });
    expect(await provider()).toEqual([]);
  });
});
