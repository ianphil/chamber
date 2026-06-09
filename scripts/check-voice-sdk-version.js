/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const rootPkgPath = path.join(repoRoot, 'package.json');
const voiceRuntimePkgPath = path.join(repoRoot, 'chamber-voice-runtime', 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readDependency(pkg, packageName, filePath) {
  const version = pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing ${packageName} dependency in ${filePath}`);
  }
  return version;
}

try {
  const rootPkg = readJson(rootPkgPath);
  const voiceRuntimePkg = readJson(voiceRuntimePkgPath);
  const rootVersion = readDependency(rootPkg, 'foundry-local-sdk', rootPkgPath);
  const runtimeVersion = readDependency(voiceRuntimePkg, 'foundry-local-sdk', voiceRuntimePkgPath);

  if (rootVersion !== runtimeVersion) {
    console.error('\n❌ Voice SDK version mismatch:\n');
    console.error(`   package.json requires foundry-local-sdk ${rootVersion}`);
    console.error(`   chamber-voice-runtime/package.json requires foundry-local-sdk ${runtimeVersion}`);
    console.error('');
    process.exit(1);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
