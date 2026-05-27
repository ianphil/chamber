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

resignCopilotSeaBinaries(appPath, identity);

function findCopilotSeaBinaries(rootDir) {
  const matches = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile()
        && entry.name === 'copilot'
        && /@github[\\/]copilot-darwin-[^\\/]+[\\/]copilot$/.test(fullPath)
      ) {
        matches.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return matches;
}

function resignCopilotSeaBinaries(bundlePath, codeSignIdentity) {
  // The bundled @github/copilot CLI is a Node.js Single Executable
  // Application. electron-osx-sign re-signs every nested executable
  // with its default entitlements (audio, bluetooth, camera, etc.)
  // which lack the JIT/library entitlements V8 needs under hardened
  // runtime. Without them the kernel kills the process immediately
  // and Chamber surfaces "CLI server exited unexpectedly with code 1".
  // Re-sign just those binaries with the Node SEA-friendly plist.
  const entitlements = path.join(repoRoot, 'assets', 'entitlements.copilot-cli.mac.plist');
  if (!fs.existsSync(entitlements)) {
    throw new Error(`Missing copilot CLI entitlements: ${entitlements}`);
  }
  const binaries = findCopilotSeaBinaries(bundlePath);
  if (binaries.length === 0) {
    console.warn('No bundled @github/copilot SEA binaries found to re-sign.');
    return;
  }
  const identityArgs = codeSignIdentity ? ['--sign', codeSignIdentity] : ['--sign', '-'];
  for (const binary of binaries) {
    runCommand('codesign', [
      '--force',
      '--timestamp',
      '--options', 'runtime',
      '--entitlements', entitlements,
      ...identityArgs,
      binary,
    ]);
    console.log(`Re-signed SEA binary ${path.relative(repoRoot, binary)}`);
  }
}
