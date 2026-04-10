/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const targetDir = path.join(repoRoot, 'resources', 'node');
const markerPath = path.join(targetDir, 'version.txt');

function getNodeBinary(rootDir) {
  return process.platform === 'win32'
    ? path.join(rootDir, 'node.exe')
    : path.join(rootDir, 'bin', 'node');
}

function getNpmCli(rootDir) {
  const candidates = process.platform === 'win32'
    ? [
        path.join(rootDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(rootDir, 'npm', 'bin', 'npm-cli.js'),
      ]
    : [
        path.join(rootDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(rootDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function validateRuntimeDir(rootDir) {
  const nodeBinary = getNodeBinary(rootDir);
  if (!fs.existsSync(nodeBinary)) {
    throw new Error(`Node binary not found in runtime: ${nodeBinary}`);
  }

  const npmCli = getNpmCli(rootDir);
  if (!npmCli) {
    throw new Error(`npm CLI not found in runtime: ${rootDir}`);
  }

  return { nodeBinary, npmCli };
}

function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function readNvmrcVersion() {
  try {
    const content = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf-8').trim();
    if (content) return content;
  } catch {
    // ignore
  }
  return '20';
}

function resolveVersion() {
  const raw = process.env.GENESIS_NODE_VERSION || readNvmrcVersion();
  if (/^\d+$/.test(raw)) {
    return `${raw}.19.2`;
  }
  return raw.replace(/^v/, '');
}

function resolveDist(version) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  switch (process.platform) {
    case 'win32':
      return { dist: `node-v${version}-win-${arch}`, ext: 'zip' };
    case 'darwin':
      return { dist: `node-v${version}-darwin-${arch}`, ext: 'tar.gz' };
    case 'linux':
      return { dist: `node-v${version}-linux-${arch}`, ext: 'tar.gz' };
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function extractArchive(archivePath, extractDir, ext) {
  if (ext === 'zip') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(extractDir)} -Force`,
    ].join('; ');

    runCommand('powershell', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    return;
  }

  runCommand('tar', ['-xzf', archivePath, '-C', extractDir]);
}

function promoteRuntime(extractedDir, version) {
  const resourcesDir = path.dirname(targetDir);
  const stagingDir = path.join(resourcesDir, 'node.new');
  const backupDir = path.join(resourcesDir, 'node.old');

  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });

  fs.cpSync(extractedDir, stagingDir, { recursive: true });
  fs.writeFileSync(path.join(stagingDir, 'version.txt'), version, 'utf-8');
  validateRuntimeDir(stagingDir);

  let previousRuntimeMoved = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      previousRuntimeMoved = true;
    }

    fs.renameSync(stagingDir, targetDir);
    validateRuntimeDir(targetDir);
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    if (previousRuntimeMoved && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir);
    }
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyIntegrity(filePath, version, filename) {
  const shasumsUrl = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  console.log(`Fetching checksums from ${shasumsUrl}`);
  const shasums = await downloadText(shasumsUrl);

  const expectedLine = shasums.split('\n').find((line) => line.includes(filename));
  if (!expectedLine) {
    throw new Error(`Could not find checksum for ${filename} in SHASUMS256.txt`);
  }
  const expectedHash = expectedLine.trim().split(/\s+/)[0];

  console.log('Verifying download integrity...');
  const actualHash = await computeFileHash(filePath);

  if (actualHash !== expectedHash) {
    throw new Error(
      `Integrity check failed for ${filename}.\n`
      + `  Expected: ${expectedHash}\n`
      + `  Actual:   ${actualHash}`
    );
  }
  console.log('Integrity check passed.');
}

async function main() {
  const version = resolveVersion();
  const { dist, ext } = resolveDist(version);
  const nodeBinary = getNodeBinary(targetDir);

  if (fs.existsSync(markerPath) && fs.existsSync(nodeBinary)) {
    const existing = fs.readFileSync(markerPath, 'utf-8').trim();
    if (existing === version) {
      console.log(`Bundled Node runtime already present (v${version}).`);
      return;
    }
  }

  const url = `https://nodejs.org/dist/v${version}/${dist}.${ext}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-node-'));
  try {
    const archivePath = path.join(tempDir, `${dist}.${ext}`);
    const extractDir = path.join(tempDir, 'extract');

    console.log(`Downloading ${url}`);
    await downloadFile(url, archivePath);

    const archiveFilename = `${dist}.${ext}`;
    await verifyIntegrity(archivePath, version, archiveFilename);

    console.log('Extracting Node runtime...');
    fs.mkdirSync(extractDir, { recursive: true });
    extractArchive(archivePath, extractDir, ext);

    const extractedDir = path.join(extractDir, dist);
    if (!fs.existsSync(extractedDir)) {
      throw new Error(`Extracted Node directory not found: ${extractedDir}`);
    }
    validateRuntimeDir(extractedDir);

    promoteRuntime(extractedDir, version);

    console.log(`Bundled Node runtime ready at ${targetDir}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
