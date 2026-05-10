const fs = require('node:fs');
const path = require('node:path');
const { WINDOWS_PUBLISHER_NAME } = require('./windows-publisher.cjs');

const repoRoot = path.resolve(__dirname, '..');
const signingEnabled = process.env.CHAMBER_WINDOWS_SIGNING === 'true';
const macSigningEnabled = process.env.CHAMBER_MACOS_SIGNING === 'true';
const macNotarizeEnabled =
  macSigningEnabled
  && Boolean(process.env.APPLE_TEAM_ID)
  && Boolean(process.env.APPLE_ID)
  && Boolean(process.env.APPLE_ID_PASSWORD);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable for Windows signing: ${name}`);
  }
  return value;
}

function resolvePublisherName() {
  return process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME?.trim() || WINDOWS_PUBLISHER_NAME;
}

function resolveMacIcon() {
  const icnsPath = path.join(repoRoot, 'assets', 'app.icns');
  return fs.existsSync(icnsPath) ? icnsPath : undefined;
}

function resolveMacEntitlements() {
  const entitlementsPath = path.join(repoRoot, 'assets', 'entitlements.mac.plist');
  return fs.existsSync(entitlementsPath) ? entitlementsPath : undefined;
}

const config = {
  appId: 'dev.chmbr.chamber',
  productName: 'Chamber',
  artifactName: 'Chamber-${version}-${arch}.${ext}',
  protocols: [
    {
      name: 'Chamber',
      schemes: ['chamber'],
    },
  ],
  directories: {
    output: 'out/builder',
    buildResources: 'assets',
  },
  win: {
    executableName: 'chamber',
    icon: path.join(repoRoot, 'assets', 'app.ico'),
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    ...(signingEnabled
      ? {
          signtoolOptions: {
            publisherName: resolvePublisherName(),
            signingHashAlgorithms: ['sha256'],
            sign: path.join(repoRoot, 'scripts', 'sign-windows-trusted-signing.js'),
          },
        }
      : {
          signAndEditExecutable: false,
        }),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'Chamber',
  },
  mac: {
    category: 'public.app-category.productivity',
    icon: resolveMacIcon(),
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    hardenedRuntime: macSigningEnabled,
    gatekeeperAssess: false,
    entitlements: resolveMacEntitlements(),
    entitlementsInherit: resolveMacEntitlements(),
    ...(macSigningEnabled
      ? {
          identity: process.env.CHAMBER_MACOS_IDENTITY?.trim() || undefined,
          ...(macNotarizeEnabled
            ? { notarize: { teamId: process.env.APPLE_TEAM_ID } }
            : {}),
        }
      : { identity: null }),
  },
  dmg: {
    sign: macSigningEnabled,
  },
  publish: [
    {
      provider: 'github',
      owner: 'ianphil',
      repo: 'chamber',
      releaseType: 'release',
    },
  ],
};

module.exports = config;
