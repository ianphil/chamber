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
const appAsarPath = path.join(packageDir, 'resources', 'app.asar');
if (!fs.existsSync(appAsarPath)) {
  console.error(`No packaged app found at ${appAsarPath}. Run \`npm run make\` first.`);
  process.exit(1);
}

const appAsarFiles = asar.listPackage(appAsarPath);
const rendererEntry = '/.vite/renderer/main_window/index.html';
const normalizedAppAsarFiles = appAsarFiles.map((file) => file.replaceAll('\\', '/'));
if (!normalizedAppAsarFiles.includes(rendererEntry)) {
  console.error(`Packaged app is missing renderer entry ${rendererEntry}.`);
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
