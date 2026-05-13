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

const current = readSentinel();
const action = decideAction({ target, current });

if (action === 'noop') {
  console.log(`[ensure-native-abi] better-sqlite3 already built for ${target} — skipping rebuild`);
  process.exit(0);
}

console.log(
  `[ensure-native-abi] better-sqlite3 ABI target=${target}, current=${current ?? 'unknown'} — rebuilding...`,
);

try {
  rebuild(target);
  writeSentinel(target);
  console.log(`[ensure-native-abi] better-sqlite3 now built for ${target}`);
} catch (err) {
  console.error(`[ensure-native-abi] rebuild failed: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
