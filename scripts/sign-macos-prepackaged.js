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

resignCopilotSeaBinaries(appPath);

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

function resolveCodesignIdentity() {
  // codesign --sign needs to refer to a real Developer ID identity in
  // the keychain — falling back to ad-hoc signing ('--sign -') would
  // strip both the Developer ID assertion and the secure timestamp,
  // and Apple's notary service rejects the bundle.
  //
  // Prefer an explicit CHAMBER_MACOS_IDENTITY (used by some local
  // flows). When unset — the default in CI, where electron-osx-sign
  // auto-discovers from a freshly-imported temp keychain — discover
  // the Developer ID Application identity ourselves by parsing
  // `security find-identity` and return its SHA-1 hash. The hash is
  // an unambiguous identity selector for codesign.
  const explicit = process.env.CHAMBER_MACOS_IDENTITY?.trim();
  if (explicit) return explicit;

  const args = ['find-identity', '-v', '-p', 'codesigning'];
  const keychain = process.env.CHAMBER_NOTARY_KEYCHAIN?.trim();
  if (keychain) args.push(keychain);
  const result = spawnSync('security', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `security find-identity failed (exit ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  // Lines look like:  1) <SHA1> "Developer ID Application: Name (TEAMID)"
  const match = result.stdout.match(/^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"Developer ID Application:[^"]+"/m);
  if (!match?.[1]) {
    throw new Error(
      `No "Developer ID Application" identity found in keychain. find-identity output:\n${result.stdout}`,
    );
  }
  return match[1];
}

function resignCopilotSeaBinaries(bundlePath) {
  // The bundled @github/copilot CLI is a Node.js Single Executable
  // Application. electron-osx-sign re-signs every nested executable
  // with its default entitlements (audio, bluetooth, camera, etc.)
  // which lack the JIT/library entitlements V8 needs under hardened
  // runtime. Without them the kernel kills the process immediately
  // and Chamber surfaces "CLI server exited unexpectedly with code 1".
  // Re-sign just those binaries with the Node SEA-friendly plist,
  // then re-seal the .app's outer signature so the bundle's
  // CodeResources hash list reflects the new inner-binary hashes.
  const entitlements = path.join(repoRoot, 'assets', 'entitlements.copilot-cli.mac.plist');
  if (!fs.existsSync(entitlements)) {
    throw new Error(`Missing copilot CLI entitlements: ${entitlements}`);
  }
  const binaries = findCopilotSeaBinaries(bundlePath);
  if (binaries.length === 0) {
    console.warn('No bundled @github/copilot SEA binaries found to re-sign.');
    return;
  }
  const codeSignIdentity = resolveCodesignIdentity();
  if (!codeSignIdentity) {
    throw new Error('No codesign identity available for re-signing copilot SEA binaries.');
  }
  const identityArgs = ['--sign', codeSignIdentity];
  const keychainArgs = process.env.CHAMBER_NOTARY_KEYCHAIN?.trim()
    ? ['--keychain', process.env.CHAMBER_NOTARY_KEYCHAIN.trim()]
    : [];
  for (const binary of binaries) {
    runCommand('codesign', [
      '--force',
      '--timestamp',
      '--options', 'runtime',
      '--entitlements', entitlements,
      ...identityArgs,
      ...keychainArgs,
      binary,
    ]);
    console.log(`Re-signed SEA binary ${path.relative(repoRoot, binary)}`);
  }

  // Re-seal the .app at the top level (not --deep) to regenerate
  // _CodeSignature/CodeResources with hashes of the newly-signed
  // copilot binaries. Without this, notarization rejects the bundle
  // with "The signature of the binary is invalid" on the main
  // Chamber executable because the seal references stale hashes.
  // --preserve-metadata keeps the existing entitlements/identifier
  // that electron-osx-sign applied to the main executable.
  runCommand('codesign', [
    '--force',
    '--timestamp',
    '--options', 'runtime',
    '--preserve-metadata=entitlements,identifier,flags,runtime',
    ...identityArgs,
    ...keychainArgs,
    bundlePath,
  ]);
  console.log(`Re-sealed ${path.relative(repoRoot, bundlePath)} outer signature`);
}
