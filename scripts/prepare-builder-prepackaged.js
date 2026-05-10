/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { WINDOWS_PUBLISHER_NAME } = require('../config/windows-publisher.cjs');

const repoRoot = path.resolve(__dirname, '..');
const signingEnabled = process.env.CHAMBER_WINDOWS_SIGNING === 'true';

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match?.[1]) args.set(match[1], match[2] ?? '');
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));
const targetPlatform = cliArgs.get('platform') ?? process.platform;
const targetArch = cliArgs.get('arch') ?? process.arch;

function resolvePrepackagedLayout(platform, arch) {
  const baseDir = path.join(repoRoot, 'out', `Chamber-${platform}-${arch}`);
  if (platform === 'darwin') {
    const resourcesDir = path.join(baseDir, 'Chamber.app', 'Contents', 'Resources');
    return { baseDir, resourcesDir };
  }
  return { baseDir, resourcesDir: path.join(baseDir, 'resources') };
}

const { baseDir: prepackagedDir, resourcesDir } = resolvePrepackagedLayout(targetPlatform, targetArch);
const appUpdatePath = path.join(resourcesDir, 'app-update.yml');

function requireDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Expected directory to exist: ${dir}`);
  }
}

function yamlString(value) {
  return JSON.stringify(value);
}

function resolvePublisherName() {
  if (targetPlatform !== 'win32') return null;

  const publisherName = process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME?.trim();
  if (publisherName) {
    return publisherName;
  }

  return signingEnabled ? WINDOWS_PUBLISHER_NAME : null;
}

function appendPublisherName(lines) {
  const publisherName = resolvePublisherName();
  if (publisherName) {
    const insertIndex = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    lines.splice(insertIndex, 0, `publisherName: ${yamlString(publisherName)}`);
  }
  return lines;
}

function resolveAppUpdateConfig() {
  const genericUrl = process.env.CHAMBER_BUILDER_UPDATE_URL?.trim();
  if (genericUrl) {
    return appendPublisherName([
      'provider: generic',
      `url: ${genericUrl}`,
      'updaterCacheDirName: chamber-updater',
      '',
    ]).join('\n');
  }

  return appendPublisherName([
    'provider: github',
    'owner: ianphil',
    'repo: chamber',
    'updaterCacheDirName: chamber-updater',
    '',
  ]).join('\n');
}

requireDir(prepackagedDir);
requireDir(resourcesDir);

fs.writeFileSync(appUpdatePath, resolveAppUpdateConfig(), 'utf8');
console.log(`Wrote ${path.relative(repoRoot, appUpdatePath)}`);
