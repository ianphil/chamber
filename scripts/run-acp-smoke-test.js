// Real-CLI smoke for the chamber-copilot ACP integration.
//
// Mirrors the shape of scripts/run-sdk-smoke-test.js. Spawns a real
// `copilot --acp` child via chamber-copilot's defaultAcpConnectionFactory,
// drives the JobStore through one delegate -> session/update -> idle cycle,
// then tears the connection down cleanly.
//
// Gated by COPILOT_REAL_CLI=1. NOT included in the default `npm test`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SEND_TIMEOUT_MS = 180_000;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (process.env.COPILOT_REAL_CLI !== '1') {
    console.log('Skipping ACP smoke (COPILOT_REAL_CLI != 1).');
    return;
  }

  const repoRoot = process.cwd();
  const cliPath = path.join(
    repoRoot,
    'node_modules',
    '@github',
    getPlatformCopilotPackageName().split('/')[1],
    process.platform === 'win32' ? 'copilot.exe' : 'copilot',
  );
  if (!fs.existsSync(cliPath)) {
    throw new Error(`Copilot CLI not found at ${cliPath}. Run npm install first.`);
  }

  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-acp-smoke-'));
  fs.writeFileSync(
    path.join(mindPath, 'SOUL.md'),
    '# ACP Smoke Mind\n\nReply briefly. Do not call tools.\n',
  );

  const cc = await import(pathToFileURL(path.join(repoRoot, 'node_modules', 'chamber-copilot', 'index.mjs')).href);

  const connection = new cc.AcpConnection({
    connectionFactory: cc.defaultAcpConnectionFactory({
      command: cliPath,
      // Drop --no-auto-login so the smoke can use the user's cached auth,
      // mirroring chamber-copilot's own smoke (tests/smoke/acp-connection.smoke.mjs).
      args: ['--acp', '--no-auto-update'],
    }),
  });

  const updates = [];
  let jobId = null;

  try {
    await connection.start();
    if (!connection.isStarted) {
      throw new Error('AcpConnection.start did not transition to isStarted=true');
    }

    const store = new cc.JobStore({ connection });
    connection.onSessionUpdate((params) => {
      updates.push(params);
    });

    const delegated = await store.delegate({
      cwd: mindPath,
      prompt: 'Reply with exactly: Chamber ACP smoke ok',
    });
    jobId = delegated.jobId;
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new Error(`JobStore.delegate did not return a jobId: ${JSON.stringify(delegated)}`);
    }

    await waitForJobIdle(store, jobId);

    if (updates.length === 0) {
      throw new Error('ACP smoke saw no session/update notifications.');
    }

    const snapshot = store.status(jobId);
    if (snapshot.status !== cc.JOB_STATUS.IDLE) {
      throw new Error(`ACP smoke expected idle status, got ${snapshot.status}.`);
    }

    console.log(`ACP smoke passed (${updates.length} session/update events, stopReason=${snapshot.lastStopReason ?? 'unknown'}).`);
  } finally {
    if (jobId) {
      // Best-effort cancel; most jobs are already idle by here.
      try {
        const cancelStore = await import(pathToFileURL(path.join(repoRoot, 'node_modules', 'chamber-copilot', 'index.mjs')).href);
        void cancelStore;
      } catch {
        // ignore
      }
    }
    await connection.stop().catch(() => undefined);
    cleanupMind(mindPath);
  }
}

function waitForJobIdle(store, jobId) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      let snap;
      try {
        snap = store.status(jobId);
      } catch (err) {
        clearInterval(timer);
        reject(err);
        return;
      }
      if (snap.status === 'idle') {
        clearInterval(timer);
        resolve();
        return;
      }
      if (snap.status === 'errored' || snap.status === 'cancelled') {
        clearInterval(timer);
        reject(new Error(`ACP smoke job entered terminal status ${snap.status} before idle.`));
        return;
      }
      if (Date.now() - start > SEND_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error('ACP smoke timed out waiting for the job to become idle.'));
      }
    }, 250);
  });
}

function cleanupMind(mindPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(mindPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`ACP smoke could not delete temp mind ${mindPath}: ${error.message}`);
        return;
      }
    }
  }
}

function getPlatformCopilotPackageName() {
  return `@github/copilot-${normalizePlatform(process.platform)}-${normalizeArch(process.arch)}`;
}

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported Copilot runtime platform: ${platform}`);
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }
  throw new Error(`Unsupported Copilot runtime arch: ${arch}`);
}
