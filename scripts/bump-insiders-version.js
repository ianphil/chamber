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

function readLatestInsidersTag() {
  const result = spawnSync('git', ['tag', '--list', `v*-${INSIDERS_TAG}.*`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const tags = result.stdout
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/^v/, ''))
    .filter((v) => semver.valid(v));
  if (tags.length === 0) return null;
  return tags.sort(semver.rcompare)[0];
}

function resolveBaseVersion() {
  const pkgVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
  const tagVersion = readLatestInsidersTag();
  if (!tagVersion) return pkgVersion;
  // Use whichever is "newer" in semver terms so a manual stable bump can leapfrog older insider tags.
  return semver.gt(tagVersion, pkgVersion) ? tagVersion : pkgVersion;
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

const baseVersion = resolveBaseVersion();
const nextVersion = computeNextVersion(baseVersion, bumpType);

console.log(`Resolved base version: ${baseVersion}`);
console.log(`Bumping ${baseVersion} -> ${nextVersion}`);

runOrThrow('npm', ['version', nextVersion, '--no-git-tag-version']);

// Full `npm install` keeps optional cross-platform deps like @emnapi/core and
// @emnapi/runtime in the lockfile, which CI requires. Do NOT use the
// lockfile-only flag (npm install strips those entries on some npm versions).
runOrThrow('npm', ['install']);

if (cliArgs.get('print-version') === 'true') {
  console.log(nextVersion);
}

