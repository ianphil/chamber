/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const GENERATED_PATHS = [
  '.vite',
  path.join('apps', 'server', 'dist'),
  path.join('apps', 'web', 'dist'),
  'coverage',
  'out',
  'test-results',
  path.join('resources', 'node'),
  path.join('resources', 'copilot-runtime'),
  path.join('resources', 'sharp-runtime'),
  path.join('node_modules', '.vite'),
  path.join('apps', 'server', 'node_modules', '.vite'),
  path.join('apps', 'web', 'node_modules', '.vite'),
  '.nyc_output',
  '.playwright-cli',
];

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function removePath(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return false;
  }

  fs.rmSync(absolutePath, { force: true, recursive: true });
  console.log(`[clean] removed ${relativePath}`);
  return true;
}

function removeTsBuildInfoFiles(directory) {
  let removed = 0;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      removed += removeTsBuildInfoFiles(absolutePath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
      fs.rmSync(absolutePath, { force: true });
      console.log(`[clean] removed ${path.relative(repoRoot, absolutePath)}`);
      removed += 1;
    }
  }

  return removed;
}

let removedCount = 0;

for (const generatedPath of GENERATED_PATHS) {
  if (removePath(generatedPath)) {
    removedCount += 1;
  }
}

removedCount += removeTsBuildInfoFiles(repoRoot);

if (removedCount === 0) {
  console.log('[clean] no generated artifacts found');
} else {
  console.log(`[clean] removed ${removedCount} generated artifact${removedCount === 1 ? '' : 's'}`);
}
