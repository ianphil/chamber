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
  const repoRoot = process.cwd();
  const modulesDir = path.join(repoRoot, 'node_modules');
  const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
  const cliPath = path.join(
    modulesDir,
    '@github',
    getPlatformCopilotPackageName().split('/')[1],
    process.platform === 'win32' ? 'copilot.exe' : 'copilot',
  );
  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-sdk-smoke-'));
  const logDir = path.join(os.homedir(), '.chamber', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(mindPath, 'SOUL.md'), '# Smoke Mind\n\nReply briefly and do not use tools.\n');

  const sdk = await import(pathToFileURL(sdkEntry).href);
  const client = new sdk.CopilotClient({
    cliPath,
    cwd: mindPath,
    logLevel: 'all',
    cliArgs: [
      '--log-dir', logDir,
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ],
  });

  let session;
  try {
    await client.start();
    session = await client.createSession({
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await session.rpc.permissions.setApproveAll({ enabled: true });

    const response = await sendAndWaitForResponse(session, 'Reply with exactly: Chamber SDK smoke ok');
    if (!response.includes('Chamber')) {
      throw new Error(`Unexpected SDK smoke response: ${response}`);
    }
    await assertNamedSessionResume({ sdk, cliPath, mindPath, logDir });
    console.log('SDK smoke passed.');
  } finally {
    await session?.destroy().catch(() => undefined);
    await client.stop().catch(() => undefined);
    await cleanupMind(mindPath);
  }
}

async function assertNamedSessionResume({ sdk, cliPath, mindPath, logDir }) {
  const sessionId = `chamber-sdk-smoke-${Date.now()}`;
  const firstClient = new sdk.CopilotClient({
    cliPath,
    cwd: mindPath,
    logLevel: 'all',
    cliArgs: [
      '--log-dir', logDir,
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ],
  });
  const secondClient = new sdk.CopilotClient({
    cliPath,
    cwd: mindPath,
    logLevel: 'all',
    cliArgs: [
      '--log-dir', logDir,
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
    ],
  });
  let firstSession;
  let resumedSession;
  try {
    await firstClient.start();
    firstSession = await firstClient.createSession({
      sessionId,
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await firstSession.rpc.permissions.setApproveAll({ enabled: true });
    await sendAndWaitForResponse(firstSession, 'Remember this exact token: chamber-resume-smoke');
    await firstSession.disconnect();
    firstSession = undefined;
    await firstClient.stop();

    await secondClient.start();
    resumedSession = await secondClient.resumeSession(sessionId, {
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await resumedSession.rpc.permissions.setApproveAll({ enabled: true });
    const messages = await resumedSession.getMessages();
    if (!messages.some((event) => JSON.stringify(event).includes('chamber-resume-smoke'))) {
      throw new Error('Named SDK session resume did not restore prior messages.');
    }
    const response = await sendAndWaitForResponse(resumedSession, 'What exact token did I ask you to remember?');
    if (!response.includes('chamber-resume-smoke')) {
      throw new Error(`Named SDK session did not continue prior context: ${response}`);
    }
  } finally {
    await resumedSession?.disconnect().catch(() => undefined);
    await firstSession?.disconnect().catch(() => undefined);
    await secondClient.deleteSession?.(sessionId).catch(() => undefined);
    await secondClient.stop().catch(() => undefined);
    await firstClient.stop().catch(() => undefined);
  }
}

async function cleanupMind(mindPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(mindPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`SDK smoke could not delete temp mind ${mindPath}: ${error.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function sendAndWaitForResponse(session, prompt) {
  return new Promise((resolve, reject) => {
    let finalMessage = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for SDK smoke response.'));
    }, SEND_TIMEOUT_MS);

    const unsubMessage = session.on('assistant.message', (event) => {
      finalMessage = event.data.content;
    });
    const unsubIdle = session.on('session.idle', () => {
      cleanup();
      resolve(finalMessage);
    });
    const unsubError = session.on('session.error', (event) => {
      cleanup();
      reject(new Error(event.data.message));
    });

    session.send({ prompt }).catch((error) => {
      cleanup();
      reject(error);
    });

    function cleanup() {
      clearTimeout(timeout);
      unsubMessage();
      unsubIdle();
      unsubError();
    }
  });
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
