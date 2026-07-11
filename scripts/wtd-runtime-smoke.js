/* eslint-disable no-console */
// Smoke-tests the checked-in chamber-wtd-runtime/host.mjs IPC host against a
// deterministic fake @ianphil/ttasks-wtd package — no Hugging Face network
// access, no real ONNX runtime. This exercises the actual protocol contract
// (initialize / retrieve / shutdown over child-process IPC) that
// WtdRuntimeProcess (packages/services/src/wtd/WtdRuntimeProcess.ts) depends
// on, without requiring a full runtime download.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const hostScript = path.join(repoRoot, 'chamber-wtd-runtime', 'host.mjs');

async function main() {
  if (!fs.existsSync(hostScript)) {
    throw new Error(`WTD runtime host script not found at ${hostScript}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wtd-runtime-smoke-'));
  try {
    const fakeWtdEntry = writeFakeWtdPackage(tempRoot);
    const cacheDir = path.join(tempRoot, 'cache', 'wtd-mixed-v1');

    const child = fork(hostScript, [fakeWtdEntry], { silent: true });
    const stdout = collectText(child.stdout);
    const stderr = collectText(child.stderr);

    try {
      const initialized = await sendAndWait(child, {
        type: 'initialize',
        requestId: 'init-1',
        cacheDir,
        modelRepo: 'smoke/fake-repo',
        modelRevision: 'v0.0.0-smoke',
      });
      assertEqual(initialized.type, 'initialized', 'initialize response type');
      assertEqual(initialized.cacheHit, false, 'first initialize should not be a cache hit');
      assertEqual(initialized.packageVersion, '0.1.0-smoke', 'packageVersion');
      assertEqual(initialized.revision, 'v0.0.0-smoke', 'revision');

      const textResult = await sendAndWait(child, {
        type: 'retrieve',
        requestId: 'retrieve-text',
        query: 'fix independent branches and verify',
        k: 3,
        mode: 'auto',
      });
      assertEqual(textResult.type, 'retrieved', 'text retrieve response type');
      assertEqual(textResult.result.queryKind, 'text', 'text retrieve queryKind');
      if (!Array.isArray(textResult.result.candidates) || textResult.result.candidates.length !== 1) {
        throw new Error(`Expected exactly one fake candidate, got ${JSON.stringify(textResult.result.candidates)}`);
      }
      const candidate = textResult.result.candidates[0];
      assertEqual(candidate.name, 'Fake Linear Chain', 'candidate name');
      assertEqual(candidate.nodeCount, 2, 'candidate nodeCount');
      assertEqual(candidate.edgeCount, 1, 'candidate edgeCount');
      if (candidate.shape) {
        throw new Error('Runtime-client-level shape nesting must happen in WtdAdvisorService, not the host.');
      }

      const draftResult = await sendAndWait(child, {
        type: 'retrieve',
        requestId: 'retrieve-draft',
        draftDag: { title: 'fix verify publish', steps: ['Inspect', 'Fix', 'Verify', 'Publish'] },
        k: 5,
        mode: 'structural',
      });
      assertEqual(draftResult.result.queryKind, 'draftDag', 'draft retrieve queryKind');

      const invalidResult = await sendAndWait(child, {
        type: 'retrieve',
        requestId: 'retrieve-invalid',
        k: 99,
        mode: 'auto',
      });
      assertEqual(invalidResult.type, 'error', 'out-of-range k should be rejected');

      // The host exits immediately on `shutdown` and never sends an IPC
      // response — register the exit listener before sending so the (near
      // instant) exit can never race past a listener that isn't attached yet.
      const exitPromise = waitForExit(child, 5_000);
      child.send({ type: 'shutdown', requestId: 'shutdown-1' });
      const exitCode = await exitPromise;
      assertEqual(exitCode, 0, 'host exit code after shutdown');
    } finally {
      if (!child.killed) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }

    console.log('WTD runtime host smoke passed.');
    console.log(`  stdout tail: ${stdout().slice(-500)}`);
    if (stderr().trim()) {
      console.log(`  stderr tail: ${stderr().slice(-500)}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeFakeWtdPackage(tempRoot) {
  const pkgDir = path.join(tempRoot, 'fake-ttasks-wtd');
  const distDir = path.join(pkgDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@ianphil/ttasks-wtd', version: '0.1.0-smoke', type: 'module', main: './dist/index.js' }, null, 2),
  );
  fs.writeFileSync(path.join(distDir, 'index.js'), FAKE_WTD_SOURCE);
  return path.join(distDir, 'index.js');
}

const FAKE_WTD_SOURCE = `
import { mkdir } from 'node:fs/promises';

export async function downloadWtdRuntime(options) {
  await mkdir(options.outDir, { recursive: true });
  return {
    bundlePath: options.outDir,
    repo: options.repo ?? 'smoke/fake-repo',
    revision: options.revision ?? 'v0.0.0-smoke',
    files: [],
    cacheHit: false,
  };
}

export class WtdAdvisor {
  static async load(options) {
    return new WtdAdvisor(options.bundlePath);
  }

  constructor(bundlePath) {
    this.bundlePath = bundlePath;
  }

  async retrieve(request) {
    const queryKind = request.draftDag ? 'draftDag' : 'text';
    return {
      queryKind,
      querySummary: request.draftDag?.title ?? request.query ?? 'fake summary',
      candidates: [{
        id: 'fake-candidate',
        name: 'Fake Linear Chain',
        description: 'Deterministic fake candidate for smoke coverage.',
        score: 0.5,
        nodeCount: 2,
        edgeCount: 1,
        depth: 2,
        guidance: 'Do the first fake step, then the second fake step.',
        risks: ['This is a smoke-test fixture, not a real recommendation.'],
      }],
    };
  }
}
`;

function sendAndWait(child, message, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`Timed out waiting for a response to "${message.type}" (${message.requestId})`));
    }, timeoutMs);

    function onMessage(response) {
      if (!response || response.requestId !== message.requestId) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(response);
    }

    child.on('message', onMessage);
    child.send(message, (error) => {
      if (error) {
        clearTimeout(timer);
        child.off('message', onMessage);
        reject(error);
      }
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the WTD host to exit')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function collectText(stream) {
  let text = '';
  stream?.on('data', (chunk) => {
    text += chunk.toString('utf8');
  });
  return () => text;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
