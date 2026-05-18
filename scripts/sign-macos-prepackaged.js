/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match?.[1]) args.set(match[1], match[2] ?? '');
  }
  return args;
}

function resolveMacIdentity() {
  const identity = process.env.CHAMBER_MACOS_IDENTITY?.trim();
  return identity?.replace(/^Developer ID Application:\s*/, '') || undefined;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

const cliArgs = parseArgs(process.argv.slice(2));
const targetPlatform = cliArgs.get('platform') ?? process.platform;
const targetArch = cliArgs.get('arch') ?? process.arch;

if (targetPlatform !== 'darwin' || process.env.CHAMBER_MACOS_SIGNING !== 'true') {
  process.exit(0);
}

const appPath = path.join(repoRoot, 'out', `Chamber-${targetPlatform}-${targetArch}`, 'Chamber.app');
if (!fs.existsSync(appPath)) {
  throw new Error(`Expected macOS app bundle to exist: ${appPath}`);
}

const signArgs = [
  appPath,
  '--platform=darwin',
  '--type=distribution',
];
const identity = resolveMacIdentity();
if (identity) {
  signArgs.push(`--identity=${identity}`);
}

runCommand(path.join(repoRoot, 'node_modules', '.bin', 'electron-osx-sign'), signArgs);
console.log(`Signed ${path.relative(repoRoot, appPath)}`);
