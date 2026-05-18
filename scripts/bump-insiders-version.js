#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Model B insiders version computer.
 *
 * Reads:
 *   - package.json#version          (the last shipped stable version)
 *   - CHANGELOG.md  ## Unreleased   (drives the patch / minor / major decision)
 *   - git tag --list v*-insiders.*  (drives the .N counter)
 *
 * Writes:
 *   - package.json  (mutated to <target-stable>-insiders.<N> for the runner build)
 *   - package-lock.json (kept in sync via `npm install`)
 *   - GITHUB_OUTPUT  (target_stable, insider_version, counter, bump_kind)
 *
 * The mutation is NOT committed by this script. The release-insiders.yml
 * workflow consumes the mutated package.json for the build, then `git tag`s
 * v<insider_version> against the original commit. Master's package.json on
 * disk remains at the last stable version.
 *
 * Usage:
 *   node scripts/bump-insiders-version.js
 *   node scripts/bump-insiders-version.js --override-bump=patch
 *   node scripts/bump-insiders-version.js --changelog=/path/to/CHANGELOG.md
 *   node scripts/bump-insiders-version.js --dry-run
 *
 * --override-bump  Force a specific bump (patch/minor/major), ignoring
 *                  Unreleased. Emergency escape hatch; ship/release skills
 *                  never pass this in normal flow.
 * --changelog      Path override (defaults to <repo>/CHANGELOG.md).
 * --dry-run        Compute and print but do not mutate package.json.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const semver = require('semver');
const { recommendBumpFromChangelog } = require('./changelog');

const INSIDERS_TAG = 'insiders';
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const defaultChangelogPath = path.join(repoRoot, 'CHANGELOG.md');

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

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function readMasterVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!semver.valid(pkg.version)) {
    throw new Error(`package.json#version is not valid semver: ${pkg.version}`);
  }
  if (semver.prerelease(pkg.version)) {
    throw new Error(
      `package.json#version (${pkg.version}) carries a prerelease suffix. ` +
        'Master must hold the last shipped stable version under Model B. ' +
        'See ai-docs/release-channels.md.',
    );
  }
  return pkg.version;
}

function listInsiderCountersForBase(baseStable) {
  const result = spawnSync('git', ['tag', '--list', `v${baseStable}-${INSIDERS_TAG}.*`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/^v/, ''))
    .map((v) => {
      const parsed = semver.parse(v);
      if (!parsed) return -1;
      if (parsed.prerelease[0] !== INSIDERS_TAG) return -1;
      const counter = parsed.prerelease[1];
      return typeof counter === 'number' ? counter : Number.parseInt(counter, 10);
    })
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function stableTagExists(version) {
  const result = spawnSync('git', ['tag', '--list', `v${version}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() !== '';
}

function computeNextInsiderVersion({ masterVersion, bumpKind }) {
  const targetStable = semver.inc(masterVersion, bumpKind);
  if (!targetStable) throw new Error(`semver.inc returned null for ${masterVersion}/${bumpKind}`);

  if (stableTagExists(targetStable)) {
    throw new Error(
      `Target stable v${targetStable} already exists as a tag. ` +
        `Master should have been bumped to ${targetStable} after that release. ` +
        'Open the post-release bump PR before cutting another insider.',
    );
  }

  const counters = listInsiderCountersForBase(targetStable);
  const nextCounter = counters.length === 0 ? 0 : Math.max(...counters) + 1;
  const insiderVersion = `${targetStable}-${INSIDERS_TAG}.${nextCounter}`;
  return { targetStable, insiderVersion, counter: nextCounter };
}

function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.appendFileSync(outputPath, `${lines}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const overrideBump = args.get('override-bump');
  const changelogPath = args.get('changelog') ?? defaultChangelogPath;
  const dryRun = args.get('dry-run') === 'true';

  if (overrideBump && !['major', 'minor', 'patch'].includes(overrideBump)) {
    throw new Error(`--override-bump must be one of major|minor|patch, got: ${overrideBump}`);
  }

  const masterVersion = readMasterVersion();
  let bumpKind = overrideBump ?? null;
  let bumpSource = overrideBump ? 'override' : null;

  if (!bumpKind) {
    const { bump, section } = recommendBumpFromChangelog(changelogPath);
    if (!bump) {
      throw new Error(
        section.present
          ? '## Unreleased is empty. Add at least one bullet under a ### heading before cutting an insider.'
          : 'CHANGELOG.md has no ## Unreleased section. Run ship to record changes, or pass --override-bump explicitly.',
      );
    }
    bumpKind = bump;
    bumpSource = 'changelog';
  }

  const { targetStable, insiderVersion, counter } = computeNextInsiderVersion({
    masterVersion,
    bumpKind,
  });

  console.log(`Master version:    ${masterVersion}`);
  console.log(`Bump source:       ${bumpSource} (${bumpKind})`);
  console.log(`Target stable:     ${targetStable}`);
  console.log(`Insider counter:   ${counter}`);
  console.log(`Insider version:   ${insiderVersion}`);

  writeGithubOutput({
    version: insiderVersion,
    target_stable: targetStable,
    counter: String(counter),
    bump_kind: bumpKind,
    bump_source: bumpSource,
  });

  if (dryRun) {
    console.log('--dry-run: skipping package.json mutation');
    return;
  }

  runOrThrow('npm', ['version', insiderVersion, '--no-git-tag-version', '--allow-same-version']);
  runOrThrow('npm', ['install']);
}

main();
