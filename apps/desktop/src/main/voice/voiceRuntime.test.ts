import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { applyVoiceRuntimeAvailability, resolveVoiceRuntime } from './voiceRuntime';

describe('resolveVoiceRuntime', () => {
  it('resolves the development SDK from root node_modules', () => {
    const resolveModule = vi.fn(() => 'C:\\repo\\node_modules\\foundry-local-sdk\\dist\\index.js');

    expect(resolveVoiceRuntime({
      isPackaged: false,
      cwd: 'C:\\repo',
      resolveModule,
      pathExists: () => true,
    })).toEqual({
      available: true,
      sdkEntry: 'C:\\repo\\node_modules\\foundry-local-sdk\\dist\\index.js',
    });
    expect(resolveModule).toHaveBeenCalledWith('foundry-local-sdk', {
      paths: [path.join('C:\\repo', 'node_modules')],
    });
  });

  it('resolves packaged voice only from the dedicated runtime', () => {
    const resolveModule = vi.fn(() => 'C:\\app\\resources\\voice-runtime\\node_modules\\foundry-local-sdk\\dist\\index.js');

    expect(resolveVoiceRuntime({
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      cwd: 'C:\\ignored',
      resolveModule,
      pathExists: () => true,
    }).available).toBe(true);
    expect(resolveModule).toHaveBeenCalledWith('foundry-local-sdk', {
      paths: [path.join('C:\\app\\resources', 'voice-runtime', 'node_modules')],
    });
  });

  it('reports unavailable when a stable package omits the runtime', () => {
    expect(resolveVoiceRuntime({
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      cwd: 'C:\\ignored',
      pathExists: () => true,
      resolveModule: () => {
        throw new Error('Cannot find module');
      },
    })).toEqual({ available: false, sdkEntry: null });
  });

  it('does not walk above the dedicated runtime when its package is absent', () => {
    const resolveModule = vi.fn(() => 'C:\\app\\node_modules\\foundry-local-sdk\\dist\\index.js');

    expect(resolveVoiceRuntime({
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      cwd: 'C:\\ignored',
      pathExists: () => false,
      resolveModule,
    })).toEqual({ available: false, sdkEntry: null });
    expect(resolveModule).not.toHaveBeenCalled();
  });

  it('keeps voice disabled when remote policy is accidentally enabled without a runtime', () => {
    expect(applyVoiceRuntimeAvailability({
      switchboardRelay: false,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: true,
    }, false).voiceDictation).toBe(false);
  });
});
