#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * End-to-end smoke for the Chamber automation runtime.
 *
 * Spawns ScriptRunner against a fixture script under a temp mind directory,
 * using the staged resources/automation-runtime/ tree (bundled tsx + typescript
 * + @chamber/automation-runtime + ttasks).
 *
 * Run: npm run smoke:automation
 *
 * Exits 0 on a completed run with non-empty output, non-zero otherwise.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE_SCRIPT = `
import { TaskGraph, Task } from '@ianphil/ttasks-ts';
import { runGraph } from '@chamber/automation-runtime';

const graph = new TaskGraph({ id: process.env.CHAMBER_GRAPH_ID });
graph.add(Task.bash('echo from-bash-task'));

runGraph(graph).then(() => {
  console.log('automation-smoke-ok');
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

main().catch((err) => {
  console.error('[smoke:automation] FAILED:', err);
  process.exit(1);
});

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'resources', 'automation-runtime');
  if (!fs.existsSync(runtimeRoot)) {
    console.log('[smoke:automation] staging runtime first…');
    require('node:child_process').spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts', 'prepare-automation-runtime.js'),
    ], { stdio: 'inherit' });
  }

  const tsxCli = path.join(runtimeRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodePath = path.join(runtimeRoot, 'node_modules');
  if (!fs.existsSync(tsxCli)) throw new Error(`missing tsx cli at ${tsxCli}`);

  // Spawn tsx directly against a fixture script, mirroring what ScriptRunner
  // would do at runtime — without pulling TypeScript source through require().
  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-automation-smoke-'));
  fs.mkdirSync(path.join(mindPath, '.chamber', 'automation'), { recursive: true });
  fs.mkdirSync(path.join(mindPath, '.chamber', 'runs'), { recursive: true });
  const scriptPath = path.join(mindPath, '.chamber', 'automation', 'smoke.ts');
  fs.writeFileSync(scriptPath, FIXTURE_SCRIPT);

  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [tsxCli, scriptPath], {
    cwd: mindPath,
    env: {
      ...process.env,
      NODE_PATH: nodePath,
      CHAMBER_MIND_ID: 'smoke-mind',
      CHAMBER_MIND_PATH: mindPath,
      CHAMBER_GRAPH_ID: 'smoke-graph',
      CHAMBER_TTASKS_DB: path.join(mindPath, '.chamber', 'runs', 'ttasks.db'),
      CHAMBER_BRIDGE_URL: '',
      CHAMBER_BRIDGE_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });

  console.log('--- stdout ---\n' + stdout);
  if (stderr) console.log('--- stderr ---\n' + stderr);
  if (exitCode !== 0) throw new Error(`script exited with ${exitCode}`);
  if (!stdout.includes('automation-smoke-ok')) {
    throw new Error('expected "automation-smoke-ok" sentinel in stdout');
  }
  fs.rmSync(mindPath, { recursive: true, force: true });
  console.log('[smoke:automation] OK');
}
