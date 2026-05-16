#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const semver = require('semver');

const INSIDERS_TAG = 'insiders';
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args.set(key, value ?? 'true');
    }
  }
  return args;
}

function computeNextVersion(current, bumpType) {
  const parsed = semver.parse(current);
  if (!parsed) throw new Error(`Invalid current version: ${current}`);

  const isInsidersPrerelease = parsed.prerelease[0] === INSIDERS_TAG;

  if (isInsidersPrerelease && !bumpType) {
    const next = semver.inc(current, 'prerelease', INSIDERS_TAG);
    if (!next) throw new Error(`semver.inc returned null for ${current}`);
    return next;
  }

  const releaseType = bumpType
    ? `pre${bumpType}`
    : 'prerelease';

  const next = semver.inc(current, releaseType, INSIDERS_TAG);
  if (!next) throw new Error(`semver.inc returned null for ${current}/${releaseType}`);
  return next;
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

const cliArgs = parseArgs(process.argv.slice(2));
const bumpType = cliArgs.get('bump');
if (bumpType && !['major', 'minor', 'patch'].includes(bumpType)) {
  throw new Error(`--bump must be one of major|minor|patch, got: ${bumpType}`);
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = pkg.version;
const nextVersion = computeNextVersion(currentVersion, bumpType);

console.log(`Bumping ${currentVersion} -> ${nextVersion}`);

runOrThrow('npm', ['version', nextVersion, '--no-git-tag-version']);

// Full `npm install` keeps optional cross-platform deps like @emnapi/core and
// @emnapi/runtime in the lockfile, which CI requires. Do NOT use the
// lockfile-only flag (npm install strips those entries on some npm versions).
runOrThrow('npm', ['install']);

if (cliArgs.get('print-version') === 'true') {
  console.log(nextVersion);
}
