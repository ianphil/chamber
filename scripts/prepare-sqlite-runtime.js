/* eslint-disable no-console */
// Materialize better-sqlite3 into resources/sqlite-runtime/ for the packaged
// installer, rebuilt against Electron's Node ABI. Mirrors prepare-acp-runtime.js
// (clean staging dir → npm ci from pinned manifest → validate → promote with
// backup/rollback), with the addition of forcing prebuild-install to fetch the
// Electron prebuild that matches the version of `electron` resolved from the
// host repo's node_modules.
//
// Why a dedicated runtime folder: better-sqlite3 is not N-API; its native
// binary is ABI-locked to a specific NODE_MODULE_VERSION. Shipping the host's
// `node_modules/better-sqlite3` (built against the system Node ABI) leads to a
// NODE_MODULE_VERSION mismatch at runtime in Electron. The pinned runtime here
// is rebuilt with `npm_config_runtime=electron` so prebuild-install resolves
// the Electron-flavoured prebuilt binary published by better-sqlite3.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-sqlite-runtime');
const targetDir = path.join(repoRoot, 'resources', 'sqlite-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'sqlite-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'sqlite-runtime.old');

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

function readElectronVersion() {
  const electronPkg = path.join(repoRoot, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(electronPkg)) {
    throw new Error(
      `electron is not installed at ${electronPkg}. Run \`npm install\` before preparing the sqlite runtime.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(electronPkg, 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`Missing version in ${electronPkg}`);
  }
  return manifest.version;
}

function readPinnedSqliteVersion() {
  const manifestPath = path.join(manifestDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.dependencies?.['better-sqlite3'];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing better-sqlite3 dependency in ${manifestPath}`);
  }
  return version;
}

function validateRuntimeDir(runtimeRoot) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const entry = path.join(modulesDir, 'better-sqlite3', 'lib', 'index.js');
  const native = path.join(modulesDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const installedManifest = path.join(modulesDir, 'better-sqlite3', 'package.json');

  for (const filePath of [entry, native, installedManifest]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Packaged sqlite runtime is missing ${filePath}`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(installedManifest, 'utf8'));
  console.log(`Packaged better-sqlite3 runtime: better-sqlite3@${manifest.version}`);

  return { modulesDir };
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

function buildElectronEnv() {
  const electronVersion = readElectronVersion();
  return {
    ...process.env,
    // Force prebuild-install (better-sqlite3's install script) to resolve the
    // Electron-ABI prebuilt binary instead of the host Node binary.
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_build_from_source: process.env.npm_config_build_from_source ?? 'false',
  };
}

function main() {
  const pinnedVersion = readPinnedSqliteVersion();
  const electronVersion = readElectronVersion();
  console.log(
    `Preparing better-sqlite3 runtime (better-sqlite3@${pinnedVersion}, electron@${electronVersion}) at ${targetDir}`,
  );

  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev'], {
    cwd: stagingDir,
    env: buildElectronEnv(),
  });
  validateRuntimeDir(stagingDir);
  promoteRuntime();

  console.log(`Packaged better-sqlite3 runtime ready at ${targetDir}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
