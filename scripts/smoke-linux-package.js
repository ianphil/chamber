/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(repoRoot, 'out', 'Chamber-linux-x64');
const executable = path.join(packageRoot, 'chamber');
const keyringBinding = path.join(
  packageRoot,
  'resources',
  '@napi-rs',
  'keyring-linux-x64-gnu',
  'keyring.linux-x64-gnu.node',
);
const readyMarker = '[SdkLoader] Copilot runtime ready mode=packaged';
const timeoutMs = 30_000;

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`Linux package smoke requires linux-x64, found ${process.platform}-${process.arch}.`);
  }
  for (const requiredPath of [executable, keyringBinding]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Linux package smoke is missing ${requiredPath}.`);
    }
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-linux-smoke-'));
  const child = spawn(executable, [`--user-data-dir=${userDataDir}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';

  const capture = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for packaged Linux startup.\n${output}`));
      }, timeoutMs);

      const inspect = () => {
        if (!output.includes(readyMarker)) return;
        clearTimeout(timeout);
        resolve();
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Packaged Linux app exited before startup (code=${code}, signal=${signal}).\n${output}`));
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (child.exitCode !== null) {
      throw new Error(`Packaged Linux app exited immediately after startup.\n${output}`);
    }
    console.log('[smoke:linux-package] OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', resolve);
      setTimeout(() => {
        child.kill('SIGKILL');
      }, 5_000).unref();
    });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
