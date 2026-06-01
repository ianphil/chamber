#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(
  process.argv[2]
  ?? process.env.TTASKS_TS_SOURCE
  ?? path.join(os.homedir(), 'src', 'ttasks-ts', 'skills', 'ttasks-ts'),
);
const genesisMindsRoot = path.resolve(
  process.env.GENESIS_MINDS_REPO
  ?? path.join(repoRoot, '..', 'genesis-minds'),
);
const destinationRoot = path.join(genesisMindsRoot, 'plugins', 'genesis-minds', 'skills', 'ttasks');

const expectedFiles = [
  'SKILL.md',
  'patterns/agent-tasks.md',
  'patterns/custom-types.md',
  'patterns/workflow-shapes.md',
  'reference/api.md',
  'reference/state-machine.md',
];

main();

function main() {
  validateSource();
  refuseDestinationEdits();

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  const files = [];
  for (const relativePath of expectedFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const content = normalizeContent(relativePath, fs.readFileSync(sourcePath, 'utf-8'));
    fs.writeFileSync(destinationPath, content);
    files.push({ path: relativePath, sha256: sha256(content) });
  }

  fs.writeFileSync(path.join(destinationRoot, 'SOURCE.json'), JSON.stringify({
    source: 'ttasks-ts/skills/ttasks-ts',
    sourceCommit: sourceCommit(),
    syncedAt: new Date().toISOString(),
    normalized: ['SKILL.md frontmatter name: ttasks-ts -> ttasks'],
    files,
  }, null, 2) + '\n');

  console.log(`Synced ttasks skill to ${path.relative(genesisMindsRoot, destinationRoot)}`);
}

function validateSource() {
  for (const relativePath of expectedFiles) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing expected ttasks skill file: ${sourcePath}`);
    }
  }
}

function refuseDestinationEdits() {
  const relativeDestination = path.relative(genesisMindsRoot, destinationRoot);
  const status = execFileSync('git', ['status', '--porcelain', '--', relativeDestination], {
    cwd: genesisMindsRoot,
    encoding: 'utf-8',
  }).trim();
  if (status) {
    throw new Error(`Refusing to overwrite local edits under ${relativeDestination}:\n${status}`);
  }
}

function sourceCommit() {
  try {
    return execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function normalizeContent(relativePath, content) {
  if (relativePath !== 'SKILL.md') return content;
  return content.replace(/^name:\s*ttasks-ts\s*$/m, 'name: ttasks');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
