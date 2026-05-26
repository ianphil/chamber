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
  const outputDir = path.join(repoRoot, 'out', `Chamber-${platform}-${arch}`);
  if (platform === 'darwin') {
    const baseDir = path.join(outputDir, 'Chamber.app');
    const resourcesDir = path.join(baseDir, 'Contents', 'Resources');
    return { baseDir, resourcesDir };
  }
  return { baseDir: outputDir, resourcesDir: path.join(outputDir, 'resources') };
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

function resolveChannel() {
  const channel = process.env.CHAMBER_RELEASE_CHANNEL?.trim();
  return channel || null;
}

function appendChannel(lines) {
  const channel = resolveChannel();
  if (channel) {
    const insertIndex = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    lines.splice(insertIndex, 0, `channel: ${yamlString(channel)}`);
  }
  return lines;
}

function resolveAppUpdateConfig() {
  const genericUrl = process.env.CHAMBER_BUILDER_UPDATE_URL?.trim();
  if (genericUrl) {
    return appendPublisherName(appendChannel([
      'provider: generic',
      `url: ${genericUrl}`,
      'updaterCacheDirName: chamber-updater',
      '',
    ])).join('\n');
  }

  return appendPublisherName(appendChannel([
    'provider: github',
    'owner: ianphil',
    'repo: chamber',
    'updaterCacheDirName: chamber-updater',
    '',
  ])).join('\n');
}

requireDir(prepackagedDir);
requireDir(resourcesDir);

fs.writeFileSync(appUpdatePath, resolveAppUpdateConfig(), 'utf8');
console.log(`Wrote ${path.relative(repoRoot, appUpdatePath)}`);
