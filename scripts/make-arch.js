/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageDir = path.join(repoRoot, 'out', 'Chamber-linux-x64');
const outputDir = path.join(repoRoot, 'out', 'make', 'arch', 'x64');
const pkgbuildDir = path.join(repoRoot, 'packaging', 'arch');
const version = require('../package.json').version.replaceAll('-', '_');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(`Arch packages must be built on linux-x64, found ${process.platform}-${process.arch}.`);
}
if (!fs.existsSync(path.join(packageDir, 'chamber'))) {
  throw new Error(`Packaged Chamber executable not found at ${packageDir}.`);
}

fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync('makepkg', ['--clean', '--cleanbuild', '--force'], {
  cwd: pkgbuildDir,
  env: {
    ...process.env,
    CHAMBER_PACKAGE_DIR: packageDir,
    CHAMBER_REPO_ROOT: repoRoot,
    CHAMBER_VERSION: version,
    PKGDEST: outputDir,
  },
  stdio: 'inherit',
});

if (result.error || result.status !== 0) {
  throw new Error(`makepkg failed${result.error ? `: ${result.error.message}` : '.'}`);
}

const artifact = path.join(outputDir, `chamber-${version}-1-x86_64.pkg.tar.zst`);
if (!fs.existsSync(artifact)) {
  throw new Error(`Arch package was not created at ${artifact}.`);
}

console.log(`Arch package ready at ${artifact}`);
