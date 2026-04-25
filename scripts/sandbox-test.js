/* eslint-disable no-console */
/**
 * Launch a Windows Sandbox that maps the latest `out/make` build into the
 * sandbox and opens Explorer at the Squirrel installer folder. Use to
 * exercise the zero-deps first-run install experience on a clean machine.
 *
 * Usage: npm run make:sandbox  (which runs `npm run make` first)
 *        npm run sandbox       (skip rebuild, use existing artifacts)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const makeDir = path.join(repoRoot, 'out', 'make');

if (process.platform !== 'win32') {
  console.error('Windows Sandbox is Windows-only.');
  process.exit(1);
}

if (!fs.existsSync(makeDir)) {
  console.error(`No build output found at ${makeDir}. Run \`npm run make\` first.`);
  process.exit(1);
}

const squirrelDir = path.join(makeDir, 'squirrel.windows', 'x64');
const sandboxOpenTarget = fs.existsSync(squirrelDir)
  ? 'C:\\installer\\squirrel.windows\\x64'
  : 'C:\\installer';

const wsbXml = `<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${makeDir}</HostFolder>
      <SandboxFolder>C:\\installer</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>explorer.exe ${sandboxOpenTarget}</Command>
  </LogonCommand>
</Configuration>
`;

const wsbPath = path.join(os.tmpdir(), `chamber-sandbox-${process.pid}.wsb`);
fs.writeFileSync(wsbPath, wsbXml, 'utf8');

console.log(`Mapping ${makeDir} -> C:\\installer (read-only)`);
console.log(`Launching Windows Sandbox via ${wsbPath}`);

const child = spawn('cmd.exe', ['/c', 'start', '""', wsbPath], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
