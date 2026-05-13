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
// This module records the last-built ABI target in a sentinel file under
// `node_modules/better-sqlite3/build/Release/.abi-target` and exposes a
// pure `decideAction` so callers can short-circuit when the binary already
// matches. The CLI wrapper (`scripts/ensure-native-abi.cjs`) drives the
// actual rebuild via `npm rebuild` or `electron-rebuild`.

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

function decideAction({ target, current }) {
  if (!TARGETS.includes(target)) {
    throw new Error(
      `ensure-native-abi: unknown target "${target}". Expected one of: ${TARGETS.join(', ')}`,
    );
  }
  return current === target ? 'noop' : 'rebuild';
}

function writeSentinel(target, sentinelPath = DEFAULT_SENTINEL_PATH) {
  if (!TARGETS.includes(target)) {
    throw new Error(
      `ensure-native-abi: refusing to write sentinel with unknown target "${target}"`,
    );
  }
  fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
  fs.writeFileSync(sentinelPath, `${target}\n`);
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
