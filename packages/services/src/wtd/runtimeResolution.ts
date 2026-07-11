// Path resolution + validation for the packaged/dev WTD runtime — the
// bundled Node, the checked-in runtime host, the @ianphil/ttasks-wtd package
// entry, and the platform-specific onnxruntime-node native binding.
//
// Packaged builds resolve everything under `resources/wtd-runtime` (staged by
// scripts/prepare-wtd-runtime.js, insiders-only). Dev resolves the same
// layout from the repo-root `chamber-wtd-runtime/` source folder, using its
// own `node_modules` (populated by `npm ci` inside that folder — see
// scripts/prepare-wtd-runtime.js) rather than the workspace root's.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdkRuntimeLayout } from '../ports';

export interface WtdRuntimePaths {
  /** Node binary to spawn the host with (bundled Node when packaged, current Node in dev). */
  readonly nodeBinary: string;
  /** The checked-in chamber-wtd-runtime/host.mjs IPC host script. */
  readonly hostPath: string;
  /** Resolved @ianphil/ttasks-wtd package entry (dist/index.js). */
  readonly wtdEntry: string;
  /** Target-specific onnxruntime-node native binding, verified present. */
  readonly onnxBinding: string;
}

interface WtdTarget {
  readonly platform: string;
  readonly arch: string;
}

// onnxruntime-node@1.27.0 ships every platform's native binary in one
// package; scripts/prepare-wtd-runtime.js prunes the packaged copy down to a
// single target. Only these two targets are supported end to end today —
// notably NOT darwin-x64, which upstream Chamber macOS builds do not ship.
const SUPPORTED_TARGETS: readonly WtdTarget[] = [
  { platform: 'win32', arch: 'x64' },
  { platform: 'darwin', arch: 'arm64' },
];

export function assertSupportedWtdTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): void {
  const supported = SUPPORTED_TARGETS.some((target) => target.platform === platform && target.arch === arch);
  if (!supported) {
    const supportedList = SUPPORTED_TARGETS.map((target) => `${target.platform}-${target.arch}`).join(', ');
    throw new Error(`Unsupported WTD runtime target ${platform}-${arch}. Supported targets: ${supportedList}.`);
  }
}

function requireResourcesPath(layout: SdkRuntimeLayout): string {
  if (!layout.resourcesPath) {
    throw new Error('Packaged WTD runtime layout requires resourcesPath.');
  }
  return layout.resourcesPath;
}

export function resolveWtdRuntime(
  layout: SdkRuntimeLayout = { isPackaged: false, cwd: process.cwd() },
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): WtdRuntimePaths {
  assertSupportedWtdTarget(platform, arch);

  const runtimeRoot = layout.isPackaged
    ? path.join(requireResourcesPath(layout), 'wtd-runtime')
    : path.join(layout.cwd, 'chamber-wtd-runtime');

  const nodeBinary = layout.isPackaged
    ? path.join(requireResourcesPath(layout), 'node', platform === 'win32' ? 'node.exe' : path.join('bin', 'node'))
    : process.execPath;

  const hostPath = path.join(runtimeRoot, 'host.mjs');
  const wtdEntry = path.join(runtimeRoot, 'node_modules', '@ianphil', 'ttasks-wtd', 'dist', 'index.js');
  const onnxBinding = path.join(
    runtimeRoot,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    platform,
    arch,
    'onnxruntime_binding.node',
  );

  const required: ReadonlyArray<readonly [string, string]> = [
    ['bundled Node binary', nodeBinary],
    ['WTD runtime host script', hostPath],
    ['WTD package entry', wtdEntry],
    ['WTD ONNX runtime binary', onnxBinding],
  ];
  for (const [label, filePath] of required) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`WTD runtime is missing its ${label} at ${filePath}.`);
    }
  }

  return { nodeBinary, hostPath, wtdEntry, onnxBinding };
}

// The shared, versioned Hugging Face model target this build downloads by
// default (github.com/ianphil/chamber issue #400). Kept here (not imported
// from @ianphil/ttasks-wtd, which this package never depends on directly) so
// `resolveWtdRuntimeForApp` can derive the default cache path without
// duplicating the pin anywhere else in packages/services.
export const DEFAULT_WTD_MODEL_REPO = 'ianphil/wtd-mixed-v1';
export const DEFAULT_WTD_MODEL_REVISION = 'v0.4.3';

/**
 * Electron `app`-shaped inputs needed to resolve the WTD runtime AND its
 * on-disk model cache in one call — the composition root only needs to pass
 * `app.isPackaged`, `process.resourcesPath`, `process.cwd()`, and
 * `app.getPath('userData')` (in Electron) or equivalents (in tests).
 */
export interface WtdAppLayout {
  readonly isPackaged: boolean;
  readonly resourcesPath?: string;
  readonly cwd: string;
  readonly userDataPath: string;
}

export interface WtdRuntimeResolution extends WtdRuntimePaths {
  /**
   * Application-owned, versioned WTD model cache directory — shared by all
   * minds, never written under a mind directory or on every scheduled
   * automation run. Conventionally
   * `<userData>/models/wtd-mixed-v1/<revision>`.
   */
  readonly cachePath: string;
}

/**
 * Convenience wrapper around `resolveWtdRuntime` for the Electron main
 * process: resolves the runtime binaries/host/entry AND computes the
 * versioned model cache path from `app.getPath('userData')`, so the
 * composition root does not need to hand-roll the cache path convention.
 */
export function resolveWtdRuntimeForApp(
  app: WtdAppLayout,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  modelRevision: string = DEFAULT_WTD_MODEL_REVISION,
): WtdRuntimeResolution {
  const paths = resolveWtdRuntime(
    { isPackaged: app.isPackaged, cwd: app.cwd, resourcesPath: app.resourcesPath },
    platform,
    arch,
  );
  const cachePath = path.join(app.userDataPath, 'models', 'wtd-mixed-v1', modelRevision);
  return { ...paths, cachePath };
}
