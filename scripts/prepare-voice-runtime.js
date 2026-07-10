/* eslint-disable no-console */
// Materialize foundry-local-sdk into resources/voice-runtime/ for the
// packaged voice dictation runtime. The model itself is downloaded on demand
// by the SDK; this script must only stage npm package files.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-voice-runtime');
const targetDir = path.join(repoRoot, 'resources', 'voice-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'voice-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'voice-runtime.old');

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
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

function readPinnedVersion() {
  const manifestPath = path.join(manifestDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const version = manifest.dependencies?.['foundry-local-sdk'];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected foundry-local-sdk in ${manifestPath} to be pinned to an exact version. Found: ${String(version)}`);
  }
  return version;
}

function validateRuntimeDir(runtimeRoot, expectedVersion = readPinnedVersion()) {
  const packageJsonPath = path.join(runtimeRoot, 'node_modules', 'foundry-local-sdk', 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Packaged voice runtime is missing foundry-local-sdk metadata at ${packageJsonPath}`);
  }
  const installed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  if (installed.version !== expectedVersion) {
    throw new Error(`Packaged voice runtime version mismatch. Expected ${expectedVersion}, found ${String(installed.version)}.`);
  }
  return { version: installed.version };
}

function copyRuntimeManifest(destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.copyFileSync(path.join(manifestDir, 'package.json'), path.join(destinationRoot, 'package.json'));
  fs.copyFileSync(path.join(manifestDir, 'package-lock.json'), path.join(destinationRoot, 'package-lock.json'));
}

function promoteRuntime() {
  fs.rmSync(backupDir, { recursive: true, force: true });

  let movedExistingTarget = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      movedExistingTarget = true;
    }

    fs.renameSync(stagingDir, targetDir);
    validateRuntimeDir(targetDir);
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
  if (process.env.CHAMBER_RELEASE_CHANNEL !== 'insiders') {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log('Skipping Chamber voice runtime for a non-insiders package.');
    return;
  }

  const pinnedVersion = readPinnedVersion();
  console.log(`Preparing Chamber voice runtime (foundry-local-sdk@${pinnedVersion}) at ${targetDir}`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stagingDir,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  const prepared = validateRuntimeDir(stagingDir, pinnedVersion);
  promoteRuntime();

  console.log(`Packaged Chamber voice runtime ready at ${targetDir} (foundry-local-sdk@${prepared.version})`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
