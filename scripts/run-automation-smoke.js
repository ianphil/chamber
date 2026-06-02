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
import {
  Task,
  TaskGraph,
  TaskExecutor,
  SqliteStore,
  createBashHandler,
  type Store,
} from '@ianphil/ttasks-ts';
import { httpHandler } from '@chamber/automation-runtime';

const graphId = process.env.CHAMBER_GRAPH_ID;
const dbPath = process.env.CHAMBER_TTASKS_DB;
if (!graphId) throw new Error('CHAMBER_GRAPH_ID is required');
if (!dbPath) throw new Error('CHAMBER_TTASKS_DB is required');

const graph = new TaskGraph({ id: graphId });
graph.add(Task.bash('echo from-bash-task'));

const store: Store = new SqliteStore({ path: dbPath });
const executor = new TaskExecutor({ store });
executor.register('bash', createBashHandler());
executor.register('http', httpHandler);

try {
  await graph.run(executor);
} finally {
  await executor.shutdown();
}
console.log('automation-smoke-ok');
`;

main().catch((err) => {
  console.error('[smoke:automation] FAILED:', err);
  process.exit(1);
});

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'resources', 'automation-runtime');
  if (!fs.existsSync(runtimeRoot)) {
    console.log('[smoke:automation] staging runtime first...');
    require('node:child_process').spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts', 'prepare-automation-runtime.js'),
    ], { stdio: 'inherit' });
  }

  const tsxCli = path.join(runtimeRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodePath = path.join(runtimeRoot, 'node_modules');
  if (!fs.existsSync(tsxCli)) throw new Error(`missing tsx cli at ${tsxCli}`);

  // Spawn tsx directly against a fixture script, mirroring what ScriptRunner
  // would do at runtime - without pulling TypeScript source through require().
  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-automation-smoke-'));
  const automationDir = path.join(mindPath, '.chamber', 'automation');
  const runsDir = path.join(mindPath, '.chamber', 'runs');
  fs.mkdirSync(automationDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  const scriptPath = path.join(automationDir, 'smoke.ts');
  fs.writeFileSync(scriptPath, FIXTURE_SCRIPT);

  // Mirror ScriptRunner: the script uses top-level await (ESM), so mark the
  // package scope as ESM and generate a tsconfig with `paths` for the runtime
  // packages (the ESM loader ignores NODE_PATH).
  fs.writeFileSync(path.join(automationDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
  const arDir = path.join(nodePath, '@chamber', 'automation-runtime');
  const ttDir = path.join(nodePath, '@ianphil', 'ttasks-ts');
  const rel = (target) => {
    const r = path.relative(runsDir, target).split(path.sep).join('/');
    return r.length > 0 ? r : '.';
  };
  const tsconfigPath = path.join(runsDir, 'automation.tsconfig.json');
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      module: 'esnext',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      noEmit: true,
      ignoreDeprecations: '6.0',
      baseUrl: '.',
      paths: {
        '@chamber/automation-runtime': [rel(path.join(arDir, 'src', 'index.ts'))],
        '@chamber/automation-runtime/*': [rel(path.join(arDir, 'src')) + '/*'],
        '@ianphil/ttasks-ts': [rel(path.join(ttDir, 'dist', 'index'))],
        '@ianphil/ttasks-ts/*': [rel(ttDir) + '/*'],
      },
    },
    files: [rel(scriptPath)],
  }, null, 2));

  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [tsxCli, scriptPath], {
    cwd: mindPath,
    env: {
      ...process.env,
      NODE_PATH: nodePath,
      TSX_TSCONFIG_PATH: tsconfigPath,
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
