// Desktop end-to-end smoke for the chamber-copilot ACP extension.
//
// Pre-seeds ~/.chamber/config.json with `chamberCopilotEnabled: true`,
// launches the Chamber desktop app via `npm start`, loads a mind through
// the renderer's IPC API, and verifies that ChamberCopilotService
// actually spawned a child `copilot --acp` worker by looking for the
// "chamber-copilot AcpConnection started" log line.
//
// Bypasses the Playwright harness (and its webServer prerequisite)
// because this smoke only exercises Electron, not the browser app.
//
// Gated by COPILOT_REAL_CLI=1 because the spawned ACP child needs the
// signed-in user's cached Copilot auth.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SMOKE_TIMEOUT_MS = 180_000;
const CDP_PORT = Number(process.env.CHAMBER_E2E_ACP_DESKTOP_CDP_PORT ?? 9356);

main().catch((error) => {
  console.error('[acp-desktop-smoke]', error);
  process.exit(1);
});

async function main() {
  if (process.env.COPILOT_REAL_CLI !== '1') {
    console.log('Skipping ACP desktop smoke (COPILOT_REAL_CLI != 1).');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-acp-desktop-smoke-'));
  const userDataPath = path.join(root, 'user-data');
  const mindPath = path.join(root, 'acp-mind');
  seedConfig(userDataPath, { chamberCopilotEnabled: true });
  seedMind(mindPath, 'AcpSmoke', 'ACP desktop smoke probe');

  const logs = [];
  const child = spawnDesktop({ userDataPath, cdpPort: CDP_PORT, logs });

  let success = false;
  try {
    await waitForLog(logs, /chamber-copilot ACP extension enabled/, 90_000);
    console.log('[acp-desktop-smoke] Wiring confirmed via "ACP extension enabled" log line.');

    await waitForCdp(`http://127.0.0.1:${CDP_PORT}/json/version`, 90_000);
    console.log('[acp-desktop-smoke] CDP endpoint up.');

    await loadMindViaCdp(`http://127.0.0.1:${CDP_PORT}`, mindPath);
    console.log('[acp-desktop-smoke] Mind activation requested via window.electronAPI.mind.add.');

    await waitForLog(logs, /chamber-copilot AcpConnection started/, 60_000);
    console.log('[acp-desktop-smoke] Child copilot --acp worker started successfully.');

    const text = logs.join('');
    if (/Failed to start chamber-copilot AcpConnection/.test(text)) {
      throw new Error('Saw "Failed to start chamber-copilot AcpConnection" in logs.');
    }
    if (/Authentication required/i.test(text)) {
      throw new Error('Child ACP worker reported "Authentication required". Run `copilot --version` to confirm cached auth, or sign in.');
    }

    success = true;
    console.log('ACP desktop smoke passed.');
  } finally {
    teardown(child);
    cleanupTempRoot(root);
    if (!success) {
      const tail = logs.join('').split('\n').slice(-60).join('\n');
      console.error('[acp-desktop-smoke] last 60 log lines:\n' + tail);
    }
  }
}

function spawnDesktop({ userDataPath, cdpPort, logs }) {
  const env = {
    ...process.env,
    CHAMBER_E2E: '1',
    CHAMBER_E2E_USER_DATA: userDataPath,
    CHAMBER_E2E_CDP_PORT: String(cdpPort),
    CHAMBER_DISABLE_SINGLE_INSTANCE_LOCK: '1',
  };
  const command = 'npm start';
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: process.cwd(), env, windowsHide: true })
    : spawn('sh', ['-lc', command], { cwd: process.cwd(), env });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  child.on('error', (err) => logs.push(`spawn error: ${err.message}\n`));
  return child;
}

function teardown(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // ignore
  }
}

async function waitForLog(logs, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(logs.join(''))) return;
    await sleep(250);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for log matching ${pattern}`);
}

async function waitForCdp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await sleep(500);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for CDP endpoint ${url}`);
}

async function loadMindViaCdp(cdpRoot, mindPath) {
  // Wait for a stable renderer target that is fully booted (window.electronAPI
  // available). The renderer reloads itself during MindBootstrap, so picking
  // the first /json target naively races and produces "Execution context was
  // destroyed".
  const wsUrl = await pickStableRendererTarget(cdpRoot);

  await runtimeEvaluateWithRetry(wsUrl, `window.electronAPI.mind.add(${JSON.stringify(mindPath)}).then(() => 'ok').catch((err) => 'err: ' + (err && err.message || err))`);
}

async function pickStableRendererTarget(cdpRoot) {
  const deadline = Date.now() + 90_000;
  let lastWsUrl = null;
  let stableSince = 0;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`${cdpRoot}/json`)).json();
      const candidates = targets.filter((t) => t.type === 'page' && /localhost|127\.0\.0\.1|file:\/\//.test(t.url ?? ''));
      const target = candidates[0];
      if (target && target.webSocketDebuggerUrl) {
        if (target.webSocketDebuggerUrl === lastWsUrl) {
          if (Date.now() - stableSince > 4_000) {
            // probe that window.electronAPI is wired before returning
            try {
              const ok = await runtimeEvaluateOnce(target.webSocketDebuggerUrl, 'typeof window.electronAPI?.mind?.add === "function"');
              if (ok === true) return target.webSocketDebuggerUrl;
            } catch {
              // context probably reloaded; restart stable timer
              stableSince = Date.now();
            }
          }
        } else {
          lastWsUrl = target.webSocketDebuggerUrl;
          stableSince = Date.now();
        }
      }
    } catch {
      // CDP HTTP not ready yet
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for a stable renderer target with window.electronAPI bound.');
}

async function runtimeEvaluateWithRetry(wsUrl, expression) {
  const maxAttempts = 4;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const value = await runtimeEvaluateOnce(wsUrl, expression, /* awaitPromise */ true);
      if (typeof value === 'string' && value.startsWith('err:')) {
        throw new Error(`mind.add failed: ${value}`);
      }
      return value;
    } catch (error) {
      lastError = error;
      const message = (error && error.message) || String(error);
      if (/Execution context was destroyed/i.test(message) && attempt < maxAttempts - 1) {
        await sleep(1500);
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('Runtime.evaluate failed after retries.');
}

function runtimeEvaluateOnce(wsUrl, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const WebSocket = globalThis.WebSocket;
    if (!WebSocket) {
      reject(new Error('Global WebSocket not available; need Node 22+ or `ws` package.'));
      return;
    }
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for Runtime.evaluate response.'));
    }, 30_000);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise, returnByValue: true },
      }));
    };
    socket.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.id === 1) {
        clearTimeout(timer);
        socket.close();
        if (payload.error) {
          reject(new Error(`Runtime.evaluate failed: ${JSON.stringify(payload.error)}`));
        } else if (payload.result?.exceptionDetails) {
          reject(new Error(`Runtime.evaluate threw: ${payload.result.exceptionDetails.text} ${payload.result.exceptionDetails.exception?.description ?? ''}`));
        } else {
          resolve(payload.result?.result?.value);
        }
      }
    };
    socket.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err.message ?? err}`));
    };
  });
}

function seedConfig(userDataPath, partial) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataPath, 'config.json'),
    JSON.stringify({ version: 2, minds: [], ...partial }, null, 2),
  );
}

function seedMind(mindRoot, name, description) {
  fs.mkdirSync(path.join(mindRoot, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(mindRoot, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(mindRoot, 'SOUL.md'),
    [`# ${name}`, '', `You are ${name}, ${description}. Reply briefly. Do not call tools.`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(mindRoot, '.github', 'agents', `${name.toLowerCase()}.agent.md`),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name} Agent`, '', 'Help the user with concise, deterministic responses in smoke tests.', ''].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(mindRoot, '.working-memory', file), '');
  }
}

function cleanupTempRoot(root) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) {
        console.warn(`[acp-desktop-smoke] Could not delete temp root ${root}: ${err.message}`);
        return;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
