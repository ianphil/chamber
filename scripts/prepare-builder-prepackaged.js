/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const prepackagedDir = path.join(repoRoot, 'out', 'Chamber-win32-x64');
const resourcesDir = path.join(prepackagedDir, 'resources');
const appUpdatePath = path.join(resourcesDir, 'app-update.yml');
const signingEnabled = process.env.CHAMBER_WINDOWS_SIGNING === 'true';

function requireDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Expected directory to exist: ${dir}`);
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable for Windows signing: ${name}`);
  }
  return value;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function resolvePublisherName() {
  const publisherName = process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME?.trim();
  if (publisherName) {
    return publisherName;
  }

  return signingEnabled ? requireEnv('AZURE_TRUSTED_SIGNING_PUBLISHER_NAME') : null;
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
