/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
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

function env(name) {
  return process.env[name]?.trim();
}

function notarizationEnabled() {
  return Boolean(env('APPLE_TEAM_ID') && env('APPLE_ID') && env('APPLE_APP_SPECIFIC_PASSWORD'));
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
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

if (!notarizationEnabled()) {
  console.log('Skipping macOS notarization; Apple notarization credentials are not configured.');
  process.exit(0);
}

const appPath = path.join(repoRoot, 'out', `Chamber-${targetPlatform}-${targetArch}`, 'Chamber.app');
if (!fs.existsSync(appPath)) {
  throw new Error(`Expected macOS app bundle to exist: ${appPath}`);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-notarize-'));
try {
  const zipPath = path.join(tempDir, 'Chamber.app.zip');
  runCommand('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
  runCommand('xcrun', [
    'notarytool',
    'submit',
    zipPath,
    '--apple-id',
    env('APPLE_ID'),
    '--password',
    env('APPLE_APP_SPECIFIC_PASSWORD'),
    '--team-id',
    env('APPLE_TEAM_ID'),
    '--wait',
  ]);
  runCommand('xcrun', ['stapler', 'staple', appPath]);
  runCommand('xcrun', ['stapler', 'validate', appPath]);
  console.log(`Notarized and stapled ${path.relative(repoRoot, appPath)}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
