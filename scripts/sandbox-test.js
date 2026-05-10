/* eslint-disable no-console */
/**
 * Launch a Windows Sandbox that maps the latest `out/builder` build into the
 * sandbox and opens Explorer at the NSIS installer folder. Use to
 * exercise the zero-deps first-run install experience on a clean machine.
 *
 * Usage: npm run make:sandbox  (which runs `npm run make` first)
 *        npm run sandbox       (skip rebuild, use existing artifacts)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const asar = require('@electron/asar');
const { PACKAGED_RENDERER_ENTRY } = require('../config/packaged-renderer.cjs');

const repoRoot = path.resolve(__dirname, '..');
const builderDir = path.join(repoRoot, 'out', 'builder');

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

if (process.platform !== 'win32') {
  console.error('Windows Sandbox is Windows-only.');
  process.exit(1);
}

if (!fs.existsSync(builderDir)) {
  console.error(`No build output found at ${builderDir}. Run \`npm run make\` first.`);
  process.exit(1);
}

const packageDir = path.join(repoRoot, 'out', 'Chamber-win32-x64');
const packageResourcesDir = path.join(packageDir, 'resources');
const appAsarPath = path.join(packageDir, 'resources', 'app.asar');
if (!fs.existsSync(appAsarPath)) {
  console.error(`No packaged app found at ${appAsarPath}. Run \`npm run make\` first.`);
  process.exit(1);
}

const appAsarFiles = asar.listPackage(appAsarPath);
const normalizedAppAsarFiles = appAsarFiles.map((file) => file.replaceAll('\\', '/'));
if (!normalizedAppAsarFiles.includes(PACKAGED_RENDERER_ENTRY)) {
  console.error(`Packaged app is missing renderer entry ${PACKAGED_RENDERER_ENTRY}.`);
  process.exit(1);
}

const sharpRuntimePath = path.join(packageResourcesDir, 'sharp-runtime', 'node_modules', 'sharp', 'package.json');
const sharpNativePath = path.join(packageResourcesDir, 'sharp-runtime', 'node_modules', '@img', 'sharp-win32-x64', 'package.json');
if (!fs.existsSync(sharpRuntimePath)) {
  console.error(`Packaged app is missing sharp runtime metadata at ${sharpRuntimePath}.`);
  process.exit(1);
}
if (!fs.existsSync(sharpNativePath)) {
  console.error(`Packaged app is missing sharp native runtime metadata at ${sharpNativePath}.`);
  process.exit(1);
}

const acpRuntimePath = path.join(packageResourcesDir, 'acp-runtime', 'node_modules', 'chamber-copilot', 'package.json');
const acpRuntimeEntry = path.join(packageResourcesDir, 'acp-runtime', 'node_modules', 'chamber-copilot', 'index.mjs');
const acpRuntimeJsonRpcPath = path.join(packageResourcesDir, 'acp-runtime', 'node_modules', 'vscode-jsonrpc', 'package.json');
if (!fs.existsSync(acpRuntimePath)) {
  console.error(`Packaged app is missing chamber-copilot ACP runtime metadata at ${acpRuntimePath}.`);
  process.exit(1);
}
if (!fs.existsSync(acpRuntimeEntry)) {
  console.error(`Packaged app is missing chamber-copilot ACP runtime entry at ${acpRuntimeEntry}.`);
  process.exit(1);
}
if (!fs.existsSync(acpRuntimeJsonRpcPath)) {
  console.error(`Packaged app is missing vscode-jsonrpc dependency at ${acpRuntimeJsonRpcPath}.`);
  process.exit(1);
}

const sandboxOpenTarget = 'C:\\installer';

const wsbXml = `<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${escapeXml(builderDir)}</HostFolder>
      <SandboxFolder>C:\\installer</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>explorer.exe ${escapeXml(sandboxOpenTarget)}</Command>
  </LogonCommand>
</Configuration>
`;

const wsbPath = path.join(os.tmpdir(), `chamber-sandbox-${process.pid}.wsb`);
fs.writeFileSync(wsbPath, wsbXml, 'utf8');

console.log(`Mapping ${builderDir} -> C:\\installer (read-only)`);
console.log(`Launching Windows Sandbox via ${wsbPath}`);

const child = spawn('cmd.exe', ['/c', 'start', '""', wsbPath], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
