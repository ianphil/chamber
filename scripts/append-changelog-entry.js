#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * CLI: append a bullet to `## [Unreleased]` in CHANGELOG.md.
 *
 * Used by the ship skill. Creates `## [Unreleased]` and the relevant
 * `### Heading` if missing. Follows the Keep a Changelog 1.1.0
 * vocabulary.
 *
 * Usage:
 *   node scripts/append-changelog-entry.js \
 *     --kind=fixed \
 *     --summary="Bold one-liner" \
 *     --detail="Longer explanation of the change" \
 *     --issue=123
 *
 *   --kind     one of:
 *                added, changed, deprecated, removed, fixed, security  (KaC canonical)
 *                breaking                                              (Chamber extension → major)
 *                feature(s), fix(es)                                   (legacy aliases for added/fixed)
 *                perf, performance, refactor, docs, tests, build,
 *                ci, chore, release, packaging                         (Chamber extensions, patch)
 *              (case-insensitive)
 *   --summary  required, becomes **bolded** at the start of the bullet
 *   --detail   optional, follows " — " after the summary
 *   --issue    optional, appended as " (#N)" at the end
 *   --changelog  optional path override (defaults to ./CHANGELOG.md)
 */

const path = require('node:path');
const { appendEntry, HEADING_PRECEDENCE } = require('./changelog');

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.get('kind');
  const summary = args.get('summary');
  const detail = args.get('detail');
  const issue = args.get('issue');
  const changelog = args.get('changelog') ?? path.resolve(process.cwd(), 'CHANGELOG.md');

  if (!kind || !summary) {
    console.error('Usage: append-changelog-entry --kind=<heading> --summary="..." [--detail="..."] [--issue=N]');
    console.error('Known kinds:', Object.keys(HEADING_PRECEDENCE).join(', '));
    process.exit(2);
  }

  appendEntry(changelog, { kind, summary, detail, issue });
  console.log(`Appended ${kind} entry to ${changelog}`);
}

main();
