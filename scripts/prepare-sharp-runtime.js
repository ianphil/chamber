/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-sharp-runtime');
const targetDir = path.join(repoRoot, 'resources', 'sharp-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'sharp-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'sharp-runtime.old');

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported sharp runtime platform: ${platform}`);
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }
  throw new Error(`Unsupported sharp runtime arch: ${arch}`);
}

function getPlatformPackageName(platform, arch) {
  return `@img/sharp-${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function assertHostMatchesTarget(targetPlatform, targetArch) {
  if (normalizePlatform(targetPlatform) !== normalizePlatform(process.platform)
    || normalizeArch(targetArch) !== normalizeArch(process.arch)) {
    throw new Error(
      `Cross-compiling the sharp runtime is unsupported. `
      + `Host=${process.platform}-${process.arch} target=${targetPlatform}-${targetArch}.`
    );
  }
}

function assertOptionalDependenciesEnabled() {
  const omit = String(process.env.npm_config_omit || '');
  const omitted = omit.split(/[,\s]+/).filter(Boolean);
  if (omitted.includes('optional')) {
    throw new Error('Preparing the sharp runtime requires optional dependencies. Remove npm_config_omit=optional.');
  }
  if (String(process.env.npm_config_optional || '').toLowerCase() === 'false') {
    throw new Error('Preparing the sharp runtime requires optional dependencies. Remove npm_config_optional=false.');
  }
}

function spawnCommand(command, args, options = {}) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return spawnSync(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      `${command} ${args.join(' ')}`,
    ], {
      stdio: options.stdio,
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });
  }

  return spawnSync(command, args, {
    stdio: options.stdio,
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnCommand(command, args, {
    stdio: 'inherit',
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}`
      + (result.error ? ` (${result.error.message})` : '')
    );
  }
}

function validateRuntimeDir(runtimeRoot, targetPlatform, targetArch) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const sharpEntry = path.join(modulesDir, 'sharp', 'lib', 'index.js');
  const platformPackageName = getPlatformPackageName(targetPlatform, targetArch);
  const platformPackageJson = path.join(modulesDir, ...platformPackageName.split('/'), 'package.json');

  if (!fs.existsSync(sharpEntry)) {
    throw new Error(`Packaged sharp entry not found at ${sharpEntry}`);
  }
  if (!fs.existsSync(platformPackageJson)) {
    throw new Error(`Packaged sharp native package not found at ${platformPackageJson}`);
  }

  const sharp = require(path.join(modulesDir, 'sharp'));
  if (!sharp.versions?.vips) {
    throw new Error(`Packaged sharp runtime did not load libvips from ${modulesDir}`);
  }

  return { modulesDir, sharpEntry, platformPackageName };
}

function copyRuntimeManifest(destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.copyFileSync(path.join(manifestDir, 'package.json'), path.join(destinationRoot, 'package.json'));
  fs.copyFileSync(path.join(manifestDir, 'package-lock.json'), path.join(destinationRoot, 'package-lock.json'));
}

function promoteRuntime(targetPlatform, targetArch) {
  fs.rmSync(backupDir, { recursive: true, force: true });

  let movedExistingTarget = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      movedExistingTarget = true;
    }

    fs.renameSync(stagingDir, targetDir);
    validateRuntimeDir(targetDir, targetPlatform, targetArch);
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    if (movedExistingTarget && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir);
    }
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function main() {
  const targetPlatform = process.argv[2] ?? process.platform;
  const targetArch = process.argv[3] ?? process.arch;
  assertHostMatchesTarget(targetPlatform, targetArch);
  assertOptionalDependenciesEnabled();

  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev'], { cwd: stagingDir, env: process.env });
  validateRuntimeDir(stagingDir, targetPlatform, targetArch);
  promoteRuntime(targetPlatform, targetArch);

  console.log(`Packaged sharp runtime ready at ${targetDir}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
