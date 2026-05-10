/* eslint-disable no-console */
// Diagnostic for issue #90 — locate the @github/copilot model-list cache.
//
// Walks every cache/home directory the bundled CLI loader (node_modules/@github/copilot/index.js)
// resolves at startup and reports any model-shaped artifacts on disk. Run this before
// shipping a "Refresh models" affordance so the affordance is grounded in fact, not
// guesses.
//
// Usage:
//   node scripts/diagnose-model-cache.js [--mtime-only]
//
// --mtime-only skips the file-content scan and only reports paths + mtime/size.
//
// Exit code is always 0; this is a passive read-only probe.

const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const args = new Set(process.argv.slice(2));
const mtimeOnly = args.has('--mtime-only');

const HOME = homedir();
const platform = process.platform;

// Mirrors the loader paths in node_modules/@github/copilot/index.js
// (functions ge(), N(), W() in the bundled loader).
function osCacheRoot() {
  if (platform === 'darwin') return join(HOME, 'Library', 'Caches', 'copilot');
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(HOME, '.cache');
    return join(localAppData, 'copilot');
  }
  const xdg = process.env.XDG_CACHE_HOME || join(HOME, '.cache');
  return join(xdg, 'copilot');
}

function xdgCacheCopilot() {
  const xdg = process.env.XDG_CACHE_HOME || join(HOME, '.cache');
  return join(xdg, 'copilot');
}

const candidateRoots = [
  process.env.COPILOT_CACHE_HOME && join(process.env.COPILOT_CACHE_HOME, 'pkg'),
  join(osCacheRoot(), 'pkg'),
  join(xdgCacheCopilot(), 'pkg'),
  process.env.COPILOT_HOME && join(process.env.COPILOT_HOME, 'pkg'),
  join(HOME, '.copilot', 'pkg'),

  process.env.COPILOT_HOME || join(HOME, '.copilot'),

  osCacheRoot(),
  xdgCacheCopilot(),

  join(HOME, '.config', 'copilot'),
  join(HOME, '.config', 'github-copilot'),
].filter(Boolean);

const seen = new Set();
const roots = candidateRoots.filter((p) => {
  if (seen.has(p)) return false;
  seen.add(p);
  return true;
});

function walk(dir, depth = 0, max = 4) {
  if (depth > max) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, depth + 1, max));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function looksLikeModelCatalog(file) {
  if (mtimeOnly) return false;
  if (!file.endsWith('.json')) return false;
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return false;
  }
  return /"model_picker_enabled"|"capabilities"\s*:\s*\{[^}]*"family"|"models"\s*:\s*\[\s*\{[^}]*"id"/.test(
    raw
  );
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

console.log('=== @github/copilot model-cache probe ===');
console.log(`platform: ${platform}`);
console.log(`home:     ${HOME}`);
console.log(`mode:     ${mtimeOnly ? 'mtime-only' : 'full content scan'}`);
console.log('');
console.log('Candidate roots (in CLI loader resolution order):');
for (const root of roots) {
  const exists = existsSync(root) ? 'present' : 'absent';
  console.log(`  [${exists}] ${root}`);
}
console.log('');

const findings = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  const files = walk(root);
  for (const file of files) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    const isCatalog = looksLikeModelCatalog(file);
    const looksRelevant =
      isCatalog ||
      /\\models?[-_.]/i.test(file) ||
      /\/models?[-_.]/i.test(file) ||
      /catalog/i.test(file);
    if (!looksRelevant) continue;
    findings.push({
      path: file,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      modelShaped: isCatalog,
    });
  }
}

if (findings.length === 0) {
  console.log('No model-shaped on-disk artifacts found.');
  console.log('');
  console.log(
    'Conclusion: the @github/copilot CLI does NOT persist its model catalog to disk.'
  );
  console.log(
    'The cache lives in-process (a static Map on the API client class) and dies with the CLI subprocess.'
  );
  console.log(
    'See node_modules/@github/copilot/app.js — `static LIST_MODELS_CACHE_TTL_MS = 1800 * 1e3` (30 min).'
  );
} else {
  console.log(`Found ${findings.length} candidate file(s):`);
  for (const f of findings) {
    const tag = f.modelShaped ? ' [model-shaped]' : '';
    console.log(`  ${f.path}${tag}`);
    console.log(`    size: ${fmtSize(f.sizeBytes)}    mtime: ${f.mtime}`);
  }
  console.log('');
  console.log(
    'Inspect the listed paths to confirm whether any of them is consulted by the CLI for `models.list`.'
  );
  console.log(
    'If files marked [model-shaped] reappear after deletion + a CLI restart, that is the on-disk cache.'
  );
}
