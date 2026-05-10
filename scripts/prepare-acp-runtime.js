/* eslint-disable no-console */
// Materialize the chamber-copilot ACP wrapper library (and its single
// runtime dep `vscode-jsonrpc`) into resources/acp-runtime/ for the
// packaged installer. Mirrors prepare-sharp-runtime.js: clean staging
// dir, npm-install from the pinned chamber-copilot-acp-runtime/ manifest,
// validate the staged layout, then promote with backup/rollback.
//
// chamber-copilot is pure ESM with NO native bindings, so unlike sharp
// nothing here runs the module — the validator only asserts the on-disk
// layout that apps/desktop/src/main.ts:loadChamberCopilot() will require()
// from the packaged installer at runtime. A late ESM `import()` smoke is
// run via a child node process to confirm the pinned version exports the
// AcpConnection / JobStore / createAcpTools surface chamber-copilot >=
// 0.5.11 promises.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-copilot-acp-runtime');
const targetDir = path.join(repoRoot, 'resources', 'acp-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'acp-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'acp-runtime.old');

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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.dependencies?.['chamber-copilot'];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing chamber-copilot dependency in ${manifestPath}`);
  }
  return version;
}

function validateRuntimeDir(runtimeRoot) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const required = [
    // chamber-copilot is pure ESM; its entry is index.mjs, not index.js.
    path.join(modulesDir, 'chamber-copilot', 'index.mjs'),
    path.join(modulesDir, 'chamber-copilot', 'package.json'),
    // chamber-copilot's only runtime dep — used internally for JSON-RPC
    // 2.0 message correlation. Without this subpath, requiring
    // chamber-copilot at runtime fails with MODULE_NOT_FOUND.
    path.join(modulesDir, 'vscode-jsonrpc', 'package.json'),
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Packaged chamber-copilot ACP runtime is missing ${filePath}`);
    }
  }

  // Loud version cross-check so a botched lockfile or wrong manifest can't
  // silently ship a different version than the one this PR was tested
  // against.
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(modulesDir, 'chamber-copilot', 'package.json'), 'utf8'),
  );
  console.log(
    `Packaged chamber-copilot ACP runtime: chamber-copilot@${installedManifest.version}`,
  );

  return { modulesDir };
}

function smokeImportInRuntime(runtimeRoot) {
  // chamber-copilot is ESM-only, so we can't `require()` it from this
  // CommonJS prepare script. Instead, spawn a short node process inside
  // the staging dir that imports the pinned package and asserts the
  // exports we depend on actually resolve. Catches a missing subpath or
  // a botched ESM resolution before the installer ships.
  const probe = `
    import('chamber-copilot').then((mod) => {
      const required = ['AcpConnection', 'JobStore', 'createAcpTools', 'defaultAcpConnectionFactory', 'YOLO_ACP_ARGS'];
      const missing = required.filter((name) => mod[name] === undefined);
      if (missing.length > 0) {
        console.error('chamber-copilot import missing exports: ' + missing.join(', '));
        process.exit(2);
      }
    }).catch((err) => {
      console.error('chamber-copilot import failed: ' + (err && err.stack || err));
      process.exit(3);
    });
  `;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    probe,
  ], {
    stdio: 'inherit',
    cwd: runtimeRoot,
    env: process.env,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `chamber-copilot ACP runtime import smoke failed`
      + (result.error ? ` (${result.error.message})` : '')
    );
  }
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
  const pinnedVersion = readPinnedVersion();
  console.log(`Preparing chamber-copilot ACP runtime (chamber-copilot@${pinnedVersion}) at ${targetDir}`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev'], { cwd: stagingDir, env: process.env });
  validateRuntimeDir(stagingDir);
  smokeImportInRuntime(stagingDir);
  promoteRuntime();

  console.log(`Packaged chamber-copilot ACP runtime ready at ${targetDir}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
