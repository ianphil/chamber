#!/usr/bin/env node
'use strict';

// Thin CLI wrapper around scripts/lib/ensure-native-abi.cjs.
// Usage: node scripts/ensure-native-abi.cjs <node|electron>
// Wired into npm `pretest` and `presmoke:desktop` lifecycle hooks.

const {
  readSentinel,
  decideAction,
  writeSentinel,
  rebuild,
  TARGETS,
} = require('./lib/ensure-native-abi.cjs');

const target = process.argv[2];

if (!target || !TARGETS.includes(target)) {
  console.error(
    `[ensure-native-abi] usage: node scripts/ensure-native-abi.cjs <${TARGETS.join('|')}>`,
  );
  process.exit(2);
}

// process.versions.modules is the V8 ABI version (NODE_MODULE_VERSION). It's
// what a native addon must be compiled against to load in the current runtime.
// Pinning the sentinel to {target, moduleVersion} catches Node-major upgrades
// that keep target=='node' but flip the ABI.
const moduleVersion = process.versions.modules;
const current = readSentinel();
const action = decideAction({ target, current, moduleVersion });

if (action === 'noop') {
  console.log(
    `[ensure-native-abi] better-sqlite3 already built for ${target}:${moduleVersion} — skipping rebuild`,
  );
  process.exit(0);
}

console.log(
  `[ensure-native-abi] better-sqlite3 ABI target=${target}:${moduleVersion}, current=${current ?? 'unknown'} — rebuilding...`,
);

try {
  rebuild(target);
  writeSentinel({ target, moduleVersion });
  console.log(`[ensure-native-abi] better-sqlite3 now built for ${target}:${moduleVersion}`);
} catch (err) {
  console.error(`[ensure-native-abi] rebuild failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
