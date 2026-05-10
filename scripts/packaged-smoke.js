const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverBin = path.join(repoRoot, 'apps', 'server', 'dist', 'bin.mjs');
const copilotLoader = path.join(repoRoot, 'node_modules', '@github', 'copilot', 'npm-loader.js');

if (!fs.existsSync(serverBin)) {
  throw new Error(`Missing server bundle: ${serverBin}`);
}

if (!fs.existsSync(copilotLoader)) {
  throw new Error(`Missing Copilot CLI loader: ${copilotLoader}`);
}

const version = spawnSync(process.execPath, [copilotLoader, '--version'], {
  encoding: 'utf-8',
  windowsHide: true,
});

if (version.status !== 0) {
  process.stderr.write(version.stderr);
  throw new Error('Copilot CLI version check failed.');
}

console.log(version.stdout.trim());
console.log('Packaged smoke preflight passed.');
