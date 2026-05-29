/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const NOTARIZATION_TIMEOUT = process.env.CHAMBER_NOTARIZATION_TIMEOUT ?? '30m';

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
  return Boolean(
    (env('CHAMBER_NOTARY_KEYCHAIN_PROFILE') && env('CHAMBER_NOTARY_KEYCHAIN'))
      || (env('APPLE_TEAM_ID') && env('APPLE_ID') && env('APPLE_APP_SPECIFIC_PASSWORD'))
  );
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command}`);
  }
}

function runCaptured(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function notarytoolAuthArgs() {
  const profile = env('CHAMBER_NOTARY_KEYCHAIN_PROFILE');
  const keychain = env('CHAMBER_NOTARY_KEYCHAIN');
  if (profile && keychain) {
    return ['--keychain-profile', profile, '--keychain', keychain];
  }

  return [
    '--apple-id',
    env('APPLE_ID'),
    '--password',
    env('APPLE_APP_SPECIFIC_PASSWORD'),
    '--team-id',
    env('APPLE_TEAM_ID'),
  ];
}

function dumpNotaryLog(submissionId) {
  if (!submissionId) {
    console.error('Cannot fetch notary log: missing submission id.');
    return;
  }
  console.error(`\n--- Apple notary log for submission ${submissionId} ---`);
  const result = runCaptured('xcrun', [
    'notarytool',
    'log',
    submissionId,
    ...notarytoolAuthArgs(),
  ]);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.error('--- end notary log ---\n');
}

function notarize(zipPath) {
  console.log(`Submitting ${path.basename(zipPath)} for Apple notarization...`);
  const submit = runCaptured('xcrun', [
    'notarytool',
    'submit',
    zipPath,
    ...notarytoolAuthArgs(),
    '--wait',
    '--timeout',
    NOTARIZATION_TIMEOUT,
    '--output-format',
    'json',
  ]);
  if (submit.stdout) process.stdout.write(submit.stdout);
  if (submit.stderr) process.stderr.write(submit.stderr);

  let submissionId;
  let status;
  try {
    const parsed = JSON.parse(submit.stdout);
    submissionId = parsed.id;
    status = parsed.status;
  } catch {
    // notarytool occasionally prints non-JSON progress to stdout in JSON mode;
    // fall back to a regex over stderr to recover the id for log fetching.
    const idMatch = (submit.stdout + submit.stderr).match(/id:\s*([0-9a-f-]{36})/i);
    submissionId = idMatch?.[1];
  }

  if (submit.status !== 0 || (status && status !== 'Accepted')) {
    dumpNotaryLog(submissionId);
    throw new Error(`Notarization failed (status=${status ?? 'unknown'}).`);
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
  notarize(zipPath);
  runCommand('xcrun', ['stapler', 'staple', appPath]);
  runCommand('xcrun', ['stapler', 'validate', appPath]);
  console.log(`Notarized and stapled ${path.relative(repoRoot, appPath)}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
