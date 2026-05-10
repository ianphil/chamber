/* eslint-disable no-console */
// Pre-start check: ensures node_modules/@github/copilot and copilot-sdk
// match the versions pinned in package.json. Fails fast with a clear
// message instead of a cryptic runtime error.

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

const packages = ['@github/copilot', '@github/copilot-sdk'];
const errors = [];

for (const name of packages) {
  const required = rootPkg.devDependencies?.[name] ?? rootPkg.dependencies?.[name];
  if (!required) continue;

  const installedPkgPath = path.join(repoRoot, 'node_modules', ...name.split('/'), 'package.json');
  if (!fs.existsSync(installedPkgPath)) {
    errors.push(`${name} is not installed. Run: npm install`);
    continue;
  }

  const installed = JSON.parse(fs.readFileSync(installedPkgPath, 'utf-8')).version;
  // Strip leading caret/tilde for comparison
  const requiredVersion = required.replace(/^[~^]/, '');
  if (installed !== requiredVersion) {
    errors.push(`${name} is ${installed} but package.json requires ${requiredVersion}. Run: npm install`);
  }
}

if (errors.length > 0) {
  console.error('\n❌ SDK version mismatch:\n');
  for (const error of errors) {
    console.error(`   ${error}`);
  }
  console.error('');
  process.exit(1);
}
