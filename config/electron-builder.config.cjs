const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const signingEnabled = process.env.CHAMBER_WINDOWS_SIGNING === 'true';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable for Windows signing: ${name}`);
  }
  return value;
}

const config = {
  appId: 'dev.chmbr.chamber',
  productName: 'Chamber',
  artifactName: 'Chamber-${version}-${arch}.${ext}',
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
            publisherName: requireEnv('AZURE_TRUSTED_SIGNING_PUBLISHER_NAME'),
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
