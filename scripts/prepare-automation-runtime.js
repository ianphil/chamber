/* eslint-disable no-console */
/**
 * Materialize the packaged Chamber automation runtime under
 * resources/automation-runtime/ for inclusion via forge.config.ts extraResource.
 *
 * Layout produced:
 *   resources/automation-runtime/
 *     package.json
 *     node_modules/
 *       tsx/                             (4.22.3, pinned)
 *       typescript/                      (6.0.3, pinned)
 *       @chamber/automation-runtime/     (synthesized from packages/automation-runtime/src)
 *
 * ScriptRunner.defaultResolveRuntime() spawns:
 *   <resources>/node/bin/node  <resources>/automation-runtime/node_modules/tsx/dist/cli.mjs  <script>
 * with NODE_PATH=<resources>/automation-runtime/node_modules.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    ], { ...options, windowsHide: true });
  }
  return spawnSync(command, args, { ...options, windowsHide: true });
}

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-automation-runtime');
const sourcePkgDir = path.join(repoRoot, 'packages', 'automation-runtime');
const targetDir = path.join(repoRoot, 'resources', 'automation-runtime');

function rimraf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(s);
      try { fs.symlinkSync(linkTarget, d); } catch { fs.copyFileSync(s, d); }
    } else fs.copyFileSync(s, d);
  }
}

function ensureManifestInstalled() {
  const modulesDir = path.join(manifestDir, 'node_modules');
  const stamp = path.join(modulesDir, '.install-stamp');
  const pkgPath = path.join(manifestDir, 'package.json');
  const pkgStat = fs.statSync(pkgPath);
  if (fs.existsSync(stamp)) {
    const stampMs = Number(fs.readFileSync(stamp, 'utf8'));
    if (Number.isFinite(stampMs) && stampMs >= pkgStat.mtimeMs) return;
  }
  console.log('[automation-runtime] installing pinned dependencies in', manifestDir);
  const result = spawnCommand(getNpmCommand(), ['install', '--no-audit', '--no-fund'], {
    cwd: manifestDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm install in chamber-automation-runtime failed');
  fs.writeFileSync(stamp, String(pkgStat.mtimeMs));
}

function stageRuntime() {
  rimraf(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  // 1) copy package.json (for reference / debugging)
  fs.copyFileSync(
    path.join(manifestDir, 'package.json'),
    path.join(targetDir, 'package.json'),
  );

  // 2) copy installed node_modules from manifest (tsx + typescript + deps)
  copyTree(
    path.join(manifestDir, 'node_modules'),
    path.join(targetDir, 'node_modules'),
  );

  // 3) synthesize @chamber/automation-runtime from packages/automation-runtime/
  const synthDir = path.join(targetDir, 'node_modules', '@chamber', 'automation-runtime');
  rimraf(synthDir);
  fs.mkdirSync(synthDir, { recursive: true });
  fs.copyFileSync(
    path.join(sourcePkgDir, 'package.json'),
    path.join(synthDir, 'package.json'),
  );
  copyTree(
    path.join(sourcePkgDir, 'src'),
    path.join(synthDir, 'src'),
  );

  // 4) patch ttasks-ts exports map to include a "default" condition so tsx's
  //    CJS-based resolver finds the entry. The published package only declares
  //    "import" + "types", which trips ERR_PACKAGE_PATH_NOT_EXPORTED when
  //    resolved through tsx's hook.
  patchTtasksExports(targetDir);
}

function patchTtasksExports(rootDir) {
  const pkgPath = path.join(rootDir, 'node_modules', '@ianphil', 'ttasks-ts', 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.exports || typeof pkg.exports !== 'object') return;
  const root = pkg.exports['.'];
  if (root && typeof root === 'object' && !root.default) {
    root.default = root.import ?? './dist/index.js';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

function main() {
  ensureManifestInstalled();
  stageRuntime();
  console.log('[automation-runtime] staged at', targetDir);
}

main();
