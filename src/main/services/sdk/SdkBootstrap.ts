// SDK bootstrap — pure runtime path resolution and validation for dev/packaged builds.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type RuntimeVersions = {
  sdk: string;
  cli: string;
};

type RuntimeDetails = {
  mode: 'dev' | 'packaged';
  modulesDir: string;
  manifestDir: string;
  sdkVersion: string;
  cliVersion: string;
  platformPackageName: string;
  platformPackageVersion: string;
  sdkEntry: string;
  cliBinaryPath: string;
};

const isWindows = process.platform === 'win32';
let validatedRuntimeSignature: string | null = null;

function normalizePlatform(platform: NodeJS.Platform = process.platform): 'win32' | 'darwin' | 'linux' {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported Copilot runtime platform: ${platform}`);
}

function normalizeArch(arch: string = process.arch): 'x64' | 'arm64' {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }
  throw new Error(`Unsupported Copilot runtime arch: ${arch}`);
}

function readJsonFile<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    throw new Error(
      `Failed to read JSON file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function readExactDependencyVersion(packageJsonPath: string, packageName: string): string {
  const pkg = readJsonFile<{ dependencies?: Record<string, string> }>(packageJsonPath);
  const version = pkg.dependencies?.[packageName];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Chamber Copilot runtime manifest must pin ${packageName} to an exact version. Found ${String(version)} at ${packageJsonPath}.`
    );
  }
  return version;
}

function readInstalledVersion(packageJsonPath: string, packageName: string): string {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing ${packageName} package metadata at ${packageJsonPath}`);
  }

  const pkg = readJsonFile<{ version?: string }>(packageJsonPath);
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`Invalid ${packageName} package metadata at ${packageJsonPath}`);
  }
  return pkg.version;
}

export function getRuntimeManifestDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'copilot-runtime')
    : path.join(process.cwd(), 'chamber-copilot-runtime');
}

export function getRuntimeNodeModulesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'copilot-runtime', 'node_modules')
    : path.join(process.cwd(), 'node_modules');
}

export function getBundledNodeRoot(): string | null {
  if (!app.isPackaged) return null;
  const root = path.join(process.resourcesPath, 'node');
  return fs.existsSync(root) ? root : null;
}

export function getBundledNodePath(): string | null {
  const root = getBundledNodeRoot();
  if (!root) return null;
  const nodePath = isWindows
    ? path.join(root, 'node.exe')
    : path.join(root, 'bin', 'node');
  return fs.existsSync(nodePath) ? nodePath : null;
}

export function getPlatformCopilotPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `@github/copilot-${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

function getPlatformCopilotBinaryName(platform: NodeJS.Platform = process.platform): string {
  return normalizePlatform(platform) === 'win32' ? 'copilot.exe' : 'copilot';
}

export function getPlatformCopilotBinaryPath(
  modulesDir: string = getRuntimeNodeModulesDir(),
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return path.join(
    modulesDir,
    '@github',
    getPlatformCopilotPackageName(platform, arch).split('/')[1],
    getPlatformCopilotBinaryName(platform),
  );
}

export function getRequiredRuntimeVersions(manifestDir: string = getRuntimeManifestDir()): RuntimeVersions {
  const packageJsonPath = path.join(manifestDir, 'package.json');
  return {
    sdk: readExactDependencyVersion(packageJsonPath, '@github/copilot-sdk'),
    cli: readExactDependencyVersion(packageJsonPath, '@github/copilot'),
  };
}

export function validateRuntime(
  modulesDir: string = getRuntimeNodeModulesDir(),
  manifestDir: string = getRuntimeManifestDir(),
): RuntimeDetails {
  const required = getRequiredRuntimeVersions(manifestDir);
  const mode = app.isPackaged ? 'packaged' : 'dev';
  const sdkPackageJson = path.join(modulesDir, '@github', 'copilot-sdk', 'package.json');
  const cliPackageJson = path.join(modulesDir, '@github', 'copilot', 'package.json');
  const platformPackageName = getPlatformCopilotPackageName();
  const platformPackageJson = path.join(modulesDir, '@github', platformPackageName.split('/')[1], 'package.json');
  const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
  const cliBinaryPath = getPlatformCopilotBinaryPath(modulesDir);

  const sdkVersion = readInstalledVersion(sdkPackageJson, '@github/copilot-sdk');
  const cliVersion = readInstalledVersion(cliPackageJson, '@github/copilot');
  const platformPackageVersion = readInstalledVersion(platformPackageJson, platformPackageName);

  if (sdkVersion !== required.sdk) {
    throw new Error(`Expected Copilot SDK ${required.sdk}, found ${sdkVersion}.`);
  }
  if (cliVersion !== required.cli) {
    throw new Error(`Expected Copilot CLI ${required.cli}, found ${cliVersion}.`);
  }
  if (platformPackageVersion !== required.cli) {
    throw new Error(`Expected ${platformPackageName} ${required.cli}, found ${platformPackageVersion}.`);
  }
  if (!fs.existsSync(sdkEntry)) {
    throw new Error(`Copilot SDK entry not found at ${sdkEntry}`);
  }
  if (!fs.existsSync(cliBinaryPath)) {
    throw new Error(`Copilot CLI binary not found at ${cliBinaryPath}`);
  }

  if (!isWindows) {
    const stat = fs.statSync(cliBinaryPath);
    if ((stat.mode & 0o111) === 0) {
      throw new Error(`Copilot CLI binary is not executable: ${cliBinaryPath}`);
    }
  }

  return {
    mode,
    modulesDir,
    manifestDir,
    sdkVersion,
    cliVersion,
    platformPackageName,
    platformPackageVersion,
    sdkEntry,
    cliBinaryPath,
  };
}

export function isRuntimeReady(): boolean {
  try {
    validateRuntime();
    return true;
  } catch {
    return false;
  }
}

export async function ensureSdkRuntime(): Promise<void> {
  const runtime = validateRuntime();
  const signature = `${runtime.mode}:${runtime.modulesDir}:${runtime.sdkVersion}:${runtime.cliVersion}`;
  if (validatedRuntimeSignature === signature) {
    return;
  }

  console.log(
    `[SdkLoader] Copilot runtime ready mode=${runtime.mode} `
    + `sdk=${runtime.sdkVersion} cli=${runtime.cliVersion} `
    + `platformPackage=${runtime.platformPackageName}@${runtime.platformPackageVersion} `
    + `sdkEntry=${runtime.sdkEntry} cliBinary=${runtime.cliBinaryPath}`
  );
  validatedRuntimeSignature = signature;
}
