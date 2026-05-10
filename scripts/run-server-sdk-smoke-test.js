const { spawn } = require('node:child_process');
const path = require('node:path');

const serverBin = path.join(process.cwd(), 'apps', 'server', 'dist', 'bin.mjs');
const child = spawn(process.execPath, [serverBin], {
  env: {
    ...process.env,
    CHAMBER_SERVER_TOKEN: 'smoke-token',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let ready = false;
const timer = setTimeout(() => {
  if (!ready) {
    child.kill();
    console.error('Server SDK smoke timed out waiting for readiness.');
    process.exit(1);
  }
}, 10_000);

child.stdout.on('data', async (chunk) => {
  const lines = String(chunk).trim().split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const payload = JSON.parse(line);
    if (payload.type !== 'ready') continue;
    ready = true;
    clearTimeout(timer);
    try {
      const response = await fetch(`http://${payload.host}:${payload.port}/api/mind/list`, {
        headers: {
          authorization: 'Bearer smoke-token',
          origin: 'http://127.0.0.1',
        },
      });
      if (!response.ok) {
        throw new Error(`mind/list returned ${response.status}`);
      }
      child.kill();
    } catch (error) {
      child.kill();
      console.error(error);
      process.exit(1);
    }
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('exit', (code) => {
  if (!ready) {
    process.exit(code ?? 1);
  }
  process.exit(0);
});
