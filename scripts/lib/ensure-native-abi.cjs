'use strict';

// Pure-logic core for the ensure-native-abi guard.
//
// Why this exists:
//   better-sqlite3 is a native N-API module. Node 24 and Electron 41 ship
//   different V8 ABIs (137 vs 145). electron-forge silently rebuilds the
//   binary against the Electron ABI on `npm start` / `npm run package`,
//   but vitest (Node) and Playwright `_electron.launch` (Electron) have no
//   such hook — so a developer who switches between `npm test` and
//   `npm run smoke:desktop` hits "Cannot read properties of undefined"
//   crashes from the wrong-ABI .node file.
//
// What the sentinel records:
//   `${target}:${moduleVersion}` — e.g. `node:137`, `electron:125`. Both
//   axes must match the current runtime for the guard to short-circuit.
//   Recording only the framework (`node` vs `electron`) is not enough:
//   Node 23 and Node 24 share target=='node' but differ in MODULE_VERSION
//   (145 vs 137), and a developer who upgrades Node would otherwise sail
//   past the guard with a stale binary. (Caveat C-1 from the v0.60.0
//   ship review — this is the fix.)

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const TARGETS = Object.freeze(['node', 'electron']);

const DEFAULT_SENTINEL_PATH = path.join(
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  '.abi-target',
);

function readSentinel(sentinelPath = DEFAULT_SENTINEL_PATH) {
  try {
    return fs.readFileSync(sentinelPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function assertTarget(target) {
  if (!TARGETS.includes(target)) {
    throw new Error(
      `ensure-native-abi: unknown target "${target}". Expected one of: ${TARGETS.join(', ')}`,
    );
  }
}

function assertModuleVersion(moduleVersion) {
  // process.versions.modules is always a numeric string (e.g. "137"). A bad
  // value here would corrupt the sentinel — fail loudly rather than write garbage.
  if (typeof moduleVersion !== 'string' || !/^[0-9]+$/.test(moduleVersion)) {
    throw new Error(
      `ensure-native-abi: invalid moduleVersion ${JSON.stringify(moduleVersion)} — expected a numeric string from process.versions.modules`,
    );
  }
}

function sentinelValue(target, moduleVersion) {
  return `${target}:${moduleVersion}`;
}

function decideAction({ target, current, moduleVersion }) {
  assertTarget(target);
  assertModuleVersion(moduleVersion);
  return current === sentinelValue(target, moduleVersion) ? 'noop' : 'rebuild';
}

function writeSentinel({ target, moduleVersion }, sentinelPath = DEFAULT_SENTINEL_PATH) {
  assertTarget(target);
  assertModuleVersion(moduleVersion);
  fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
  fs.writeFileSync(sentinelPath, `${sentinelValue(target, moduleVersion)}\n`);
}

function rebuildCommand(target) {
  if (target === 'node') return 'npm rebuild better-sqlite3';
  if (target === 'electron') return 'npx --no-install electron-rebuild -f -w better-sqlite3';
  throw new Error(`ensure-native-abi: unknown target "${target}"`);
}

function rebuild(target, runner = (cmd) => execSync(cmd, { stdio: 'inherit' })) {
  runner(rebuildCommand(target));
}

module.exports = {
  TARGETS,
  DEFAULT_SENTINEL_PATH,
  readSentinel,
  decideAction,
  writeSentinel,
  rebuildCommand,
  rebuild,
};
