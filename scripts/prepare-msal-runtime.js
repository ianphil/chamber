/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-msal-runtime');
const targetDir = path.join(repoRoot, 'resources', 'msal-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'msal-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'msal-runtime.old');

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

function copyRuntimeManifest(destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.copyFileSync(path.join(manifestDir, 'package.json'), path.join(destinationRoot, 'package.json'));
  fs.copyFileSync(path.join(manifestDir, 'package-lock.json'), path.join(destinationRoot, 'package-lock.json'));
}

function copyPackagedKeytar(destinationRoot) {
  const source = path.join(repoRoot, 'node_modules', 'keytar');
  const destination = path.join(destinationRoot, 'node_modules', 'keytar');
  if (!fs.existsSync(path.join(source, 'lib', 'keytar.js'))) {
    throw new Error(`Root keytar package is missing: ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

function validateRuntimeDir(runtimeRoot) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const extensionEntry = path.join(modulesDir, '@azure', 'msal-node-extensions', 'lib', 'msal-node-extensions.cjs');
  const runtimeEntry = path.join(modulesDir, '@azure', 'msal-node-runtime', 'dist', 'index.cjs');
  const keytarEntry = path.join(modulesDir, 'keytar', 'lib', 'keytar.js');

  for (const entry of [extensionEntry, runtimeEntry, keytarEntry]) {
    if (!fs.existsSync(entry)) {
      throw new Error(`Packaged MSAL broker runtime entry not found at ${entry}`);
    }
  }

  return { modulesDir, extensionEntry, runtimeEntry, keytarEntry };
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
  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev'], { cwd: stagingDir, env: process.env });
  copyPackagedKeytar(stagingDir);
  validateRuntimeDir(stagingDir);
  promoteRuntime();

  console.log(`Packaged MSAL broker runtime ready at ${targetDir}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
