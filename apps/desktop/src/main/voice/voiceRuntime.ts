import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppFeatureFlags } from '@chamber/shared/feature-flags';

const runtimeRequire = createRequire(__filename);

export type VoiceRuntimeResolution =
  | { readonly available: true; readonly sdkEntry: string }
  | { readonly available: false; readonly sdkEntry: null };

interface VoiceRuntimeOptions {
  readonly isPackaged: boolean;
  readonly resourcesPath?: string;
  readonly cwd: string;
  readonly resolveModule?: (specifier: string, options: { paths: string[] }) => string;
  readonly pathExists?: (candidate: string) => boolean;
}

export function resolveVoiceRuntime(options: VoiceRuntimeOptions): VoiceRuntimeResolution {
  const searchRoot = options.isPackaged
    ? options.resourcesPath && path.join(options.resourcesPath, 'voice-runtime', 'node_modules')
    : path.join(options.cwd, 'node_modules');
  if (!searchRoot) return { available: false, sdkEntry: null };
  const pathExists = options.pathExists ?? fs.existsSync;
  if (!pathExists(path.join(searchRoot, 'foundry-local-sdk', 'package.json'))) {
    return { available: false, sdkEntry: null };
  }

  const resolveModule = options.resolveModule
    ?? ((specifier, resolveOptions) => runtimeRequire.resolve(specifier, resolveOptions));
  try {
    return {
      available: true,
      sdkEntry: resolveModule('foundry-local-sdk', { paths: [searchRoot] }),
    };
  } catch {
    return { available: false, sdkEntry: null };
  }
}

export function applyVoiceRuntimeAvailability(
  flags: AppFeatureFlags,
  runtimeAvailable: boolean,
): AppFeatureFlags {
  return {
    ...flags,
    voiceDictation: flags.voiceDictation && runtimeAvailable,
  };
}
