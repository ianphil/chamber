#!/usr/bin/env node
// Idempotent actionlint installer for local development.
//
// Downloads the pinned `rhysd/actionlint` release for the host platform/arch
// and places the binary at `node_modules/.bin/actionlint`. Skips the download
// when the binary already exists at the pinned version.
//
// CI does not use this script — `.github/workflows/governance-check.yml`
// installs actionlint via the upstream bash downloader. Keeping the local
// installer separate avoids coupling CI to npm and lets contributors run
// `npm run lint:yaml` without `brew install actionlint`.
//
// Usage:
//   node scripts/ensure-actionlint.js
//   npm run lint:yaml

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');

const ACTIONLINT_VERSION = '1.7.12';

const REPO_ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(REPO_ROOT, 'node_modules', '.bin');
const BIN_NAME = process.platform === 'win32' ? 'actionlint.exe' : 'actionlint';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const VERSION_STAMP = path.join(BIN_DIR, `.actionlint-${ACTIONLINT_VERSION}.stamp`);

function platformSlug() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386' };
  const arch = archMap[process.arch];
  if (!arch) {
    throw new Error(`[ensure-actionlint] Unsupported arch: ${process.arch}`);
  }
  if (!['linux', 'darwin', 'windows'].includes(platform)) {
    throw new Error(`[ensure-actionlint] Unsupported platform: ${platform}`);
  }
  return { platform, arch };
}

function alreadyInstalled() {
  return fs.existsSync(BIN_PATH) && fs.existsSync(VERSION_STAMP);
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`[ensure-actionlint] Download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

function extract(archivePath, destDir) {
  if (archivePath.endsWith('.zip')) {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${destDir}'`],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error('[ensure-actionlint] Expand-Archive failed');
    }
  } else {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('[ensure-actionlint] tar extraction failed');
    }
  }
}

async function main() {
  if (alreadyInstalled()) {
    return 0;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const { platform, arch } = platformSlug();
  const ext = platform === 'windows' ? 'zip' : 'tar.gz';
  const archiveName = `actionlint_${ACTIONLINT_VERSION}_${platform}_${arch}.${ext}`;
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${archiveName}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actionlint-'));
  const archivePath = path.join(tmpDir, archiveName);

  console.log(`[ensure-actionlint] Downloading ${url}`);
  await download(url, archivePath);

  console.log(`[ensure-actionlint] Extracting to ${BIN_DIR}`);
  extract(archivePath, tmpDir);

  const extractedBin = path.join(tmpDir, BIN_NAME);
  if (!fs.existsSync(extractedBin)) {
    throw new Error(`[ensure-actionlint] Binary not found after extraction: ${extractedBin}`);
  }
  fs.copyFileSync(extractedBin, BIN_PATH);
  if (process.platform !== 'win32') {
    fs.chmodSync(BIN_PATH, 0o755);
  }
  fs.writeFileSync(VERSION_STAMP, `${ACTIONLINT_VERSION}\n`);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`[ensure-actionlint] Installed actionlint v${ACTIONLINT_VERSION} at ${BIN_PATH}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
