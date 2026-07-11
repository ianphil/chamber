/* eslint-disable no-console */
// Materialize the pinned chamber-wtd-runtime manifest (ttasks-wtd + its
// checked-in host.mjs) into resources/wtd-runtime/ for insiders packages.
//
// onnxruntime-node@1.27.0 ships every supported platform's native binary in
// one package (bin/napi-v6/<platform>/<arch>/). We stage a fresh install,
// prune that tree down to the single packaging target, and validate the
// result before promoting it — mirroring scripts/prepare-sharp-runtime.js's
// stage/validate/promote/rollback shape.
//
// Stable packages do not ship WTD at all: the target directory (and any
// leftover staging/backup directories) are removed instead.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-wtd-runtime');
const targetDir = path.join(repoRoot, 'resources', 'wtd-runtime');
// Keep npm's staging cwd outside the repository so the nested git dependency
// install does not inherit Chamber's project-level min-release-age setting.
// npm prepares git dependencies with --before, which is incompatible with
// min-release-age even when every package is already pinned.
const stagingDir = path.join(os.tmpdir(), `chamber-wtd-runtime-${process.pid}.new`);
const legacyStagingDir = path.join(repoRoot, 'resources', 'wtd-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'wtd-runtime.old');

// Only these two targets are supported end to end today. Notably NOT
// darwin-x64 — Chamber macOS insiders builds target Apple Silicon only, and
// shipping an unpruned or wrong-arch onnxruntime binding would silently
// break at runtime instead of failing at package time.
const SUPPORTED_TARGETS = [
  { platform: 'win32', arch: 'x64' },
  { platform: 'darwin', arch: 'arm64' },
];

function normalizeTarget(platform, arch) {
  const supported = SUPPORTED_TARGETS.some((target) => target.platform === platform && target.arch === arch);
  if (!supported) {
    const supportedList = SUPPORTED_TARGETS.map((target) => `${target.platform}-${target.arch}`).join(', ');
    throw new Error(`Unsupported WTD runtime target ${platform}-${arch}. Supported targets: ${supportedList}.`);
  }
  return { platform, arch };
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function spawnCommand(command, args, options = {}) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return spawnSync(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      `${command} ${args.join(' ')}`,
    ], {
      stdio: options.stdio,
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });
  }

  return spawnSync(command, args, {
    stdio: options.stdio,
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnCommand(command, args, {
    stdio: 'inherit',
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}`
      + (result.error ? ` (${result.error.message})` : '')
    );
  }
}

function createNestedNpmEnvironment(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    npm_config_update_notifier: 'false',
  };
  delete env.npm_config_min_release_age;
  delete env.NPM_CONFIG_MIN_RELEASE_AGE;
  return env;
}

function copyRuntimeManifest(destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.copyFileSync(path.join(manifestDir, 'package.json'), path.join(destinationRoot, 'package.json'));
  fs.copyFileSync(path.join(manifestDir, 'package-lock.json'), path.join(destinationRoot, 'package-lock.json'));
  fs.copyFileSync(path.join(manifestDir, 'host.mjs'), path.join(destinationRoot, 'host.mjs'));
}

// Prune onnxruntime-node's bundled `bin/napi-v6/<platform>/<arch>` tree down
// to just the packaging target, and reject the presence of any other native
// platform directory that would bloat the installer or mask a pruning bug.
function pruneOnnxRuntimeBinaries(runtimeRoot, target) {
  const napiDir = path.join(runtimeRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  if (!fs.existsSync(napiDir)) {
    throw new Error(`onnxruntime-node native binary directory not found at ${napiDir}`);
  }

  for (const platformDirName of fs.readdirSync(napiDir)) {
    const platformDir = path.join(napiDir, platformDirName);
    if (!fs.statSync(platformDir).isDirectory()) continue;

    if (platformDirName !== target.platform) {
      fs.rmSync(platformDir, { recursive: true, force: true });
      continue;
    }

    for (const archDirName of fs.readdirSync(platformDir)) {
      if (archDirName !== target.arch) {
        fs.rmSync(path.join(platformDir, archDirName), { recursive: true, force: true });
      }
    }
  }
}

function assertNoForeignNativeDirs(runtimeRoot, target) {
  const napiDir = path.join(runtimeRoot, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  const remaining = fs.readdirSync(napiDir);
  const allowedPlatformDirs = new Set([target.platform]);
  for (const entry of remaining) {
    if (!allowedPlatformDirs.has(entry)) {
      throw new Error(`Packaged WTD runtime retained a foreign platform directory: ${path.join(napiDir, entry)}`);
    }
  }

  const platformDir = path.join(napiDir, target.platform);
  const remainingArches = fs.readdirSync(platformDir);
  if (remainingArches.length !== 1 || remainingArches[0] !== target.arch) {
    throw new Error(
      `Packaged WTD runtime did not prune to exactly ${target.platform}-${target.arch}: found [${remainingArches.join(', ')}] in ${platformDir}`
    );
  }
}

function readPinnedVersion() {
  const manifestPath = path.join(manifestDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const version = manifest.dependencies?.['@ianphil/ttasks-wtd'];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing @ianphil/ttasks-wtd dependency in ${manifestPath}`);
  }
  return version;
}

function validateRuntimeDir(runtimeRoot, target) {
  const versions = validateRuntimeFiles(runtimeRoot, target);
  assertNoForeignNativeDirs(runtimeRoot, target);
  return versions;
}

function validateRuntimeFiles(runtimeRoot, target) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const hostScript = path.join(runtimeRoot, 'host.mjs');
  const wtdPackageJson = path.join(modulesDir, '@ianphil', 'ttasks-wtd', 'package.json');
  const wtdEntry = path.join(modulesDir, '@ianphil', 'ttasks-wtd', 'dist', 'index.js');
  const onnxPackageJson = path.join(modulesDir, 'onnxruntime-node', 'package.json');
  const onnxBinding = path.join(
    modulesDir, 'onnxruntime-node', 'bin', 'napi-v6', target.platform, target.arch, 'onnxruntime_binding.node',
  );

  if (!fs.existsSync(hostScript)) {
    throw new Error(`Packaged WTD runtime host script not found at ${hostScript}`);
  }
  if (!fs.existsSync(wtdPackageJson)) {
    throw new Error(`Packaged @ianphil/ttasks-wtd metadata not found at ${wtdPackageJson}`);
  }
  if (!fs.existsSync(wtdEntry)) {
    throw new Error(`Packaged @ianphil/ttasks-wtd entry not found at ${wtdEntry}`);
  }
  if (!fs.existsSync(onnxPackageJson)) {
    throw new Error(`Packaged onnxruntime-node metadata not found at ${onnxPackageJson}`);
  }
  if (!fs.existsSync(onnxBinding)) {
    throw new Error(`Packaged onnxruntime-node native binding not found at ${onnxBinding}`);
  }

  const installedWtd = JSON.parse(fs.readFileSync(wtdPackageJson, 'utf-8'));
  const installedOnnx = JSON.parse(fs.readFileSync(onnxPackageJson, 'utf-8'));
  if (installedOnnx.version !== '1.27.0') {
    throw new Error(`Expected onnxruntime-node 1.27.0, found ${String(installedOnnx.version)}.`);
  }

  return { wtdVersion: installedWtd.version, onnxVersion: installedOnnx.version };
}

function isRecoverableRenameError(error) {
  return error
    && typeof error === 'object'
    && (error.code === 'EPERM' || error.code === 'EXDEV');
}

function promoteDirectory(dirs, validate = () => {}, fsImpl = fs) {
  fsImpl.rmSync(dirs.backupDir, { recursive: true, force: true });

  let movedExistingTarget = false;
  try {
    if (fsImpl.existsSync(dirs.targetDir)) {
      fsImpl.renameSync(dirs.targetDir, dirs.backupDir);
      movedExistingTarget = true;
    }

    try {
      fsImpl.renameSync(dirs.stagingDir, dirs.targetDir);
    } catch (error) {
      if (!isRecoverableRenameError(error)) {
        throw error;
      }
      fsImpl.rmSync(dirs.targetDir, { recursive: true, force: true });
      fsImpl.cpSync(dirs.stagingDir, dirs.targetDir, { recursive: true });
    }

    validate(dirs.targetDir);
    fsImpl.rmSync(dirs.backupDir, { recursive: true, force: true });
  } catch (error) {
    fsImpl.rmSync(dirs.targetDir, { recursive: true, force: true });
    if (movedExistingTarget && fsImpl.existsSync(dirs.backupDir)) {
      fsImpl.renameSync(dirs.backupDir, dirs.targetDir);
    }
    throw error;
  } finally {
    fsImpl.rmSync(dirs.stagingDir, { recursive: true, force: true });
  }
}

function promoteRuntime(target) {
  promoteDirectory(
    { stagingDir, targetDir, backupDir },
    (runtimeRoot) => validateRuntimeDir(runtimeRoot, target),
  );
}

function cleanStaleResources() {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(legacyStagingDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
}

function prepareDevRuntime() {
  let target;
  try {
    target = normalizeTarget(process.platform, process.arch);
  } catch {
    console.log(`Skipping Chamber WTD development runtime on unsupported target ${process.platform}-${process.arch}.`);
    return;
  }

  try {
    const installed = validateRuntimeFiles(manifestDir, target);
    console.log(
      `Chamber WTD development runtime is ready `
      + `(ttasks-wtd@${installed.wtdVersion}, onnxruntime-node@${installed.onnxVersion}).`
    );
    return;
  } catch {
    console.log('Installing the pinned Chamber WTD development runtime.');
  }

  runCommand(getNpmCommand(), ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: manifestDir,
    env: createNestedNpmEnvironment(),
  });
  const installed = validateRuntimeFiles(manifestDir, target);
  console.log(
    `Chamber WTD development runtime is ready `
    + `(ttasks-wtd@${installed.wtdVersion}, onnxruntime-node@${installed.onnxVersion}).`
  );
}

function main() {
  if (process.argv[2] === '--dev') {
    prepareDevRuntime();
    return;
  }

  if (process.env.CHAMBER_RELEASE_CHANNEL !== 'insiders') {
    cleanStaleResources();
    console.log('Skipping Chamber WTD runtime for a non-insiders package.');
    return;
  }

  const target = normalizeTarget(process.argv[2] ?? process.platform, process.argv[3] ?? process.arch);
  const pinnedVersion = readPinnedVersion();
  console.log(`Preparing Chamber WTD runtime (@ianphil/ttasks-wtd@${pinnedVersion}) for ${target.platform}-${target.arch} at ${targetDir}`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  copyRuntimeManifest(stagingDir);
  runCommand(getNpmCommand(), ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stagingDir,
    env: createNestedNpmEnvironment(),
  });
  pruneOnnxRuntimeBinaries(stagingDir, target);
  const prepared = validateRuntimeDir(stagingDir, target);
  promoteRuntime(target);

  console.log(
    `Packaged Chamber WTD runtime ready at ${targetDir} `
    + `(ttasks-wtd@${prepared.wtdVersion}, onnxruntime-node@${prepared.onnxVersion}, target=${target.platform}-${target.arch})`
  );
}

module.exports = {
  SUPPORTED_TARGETS,
  normalizeTarget,
  pruneOnnxRuntimeBinaries,
  assertNoForeignNativeDirs,
  validateRuntimeDir,
  validateRuntimeFiles,
  createNestedNpmEnvironment,
  readPinnedVersion,
  cleanStaleResources,
  prepareDevRuntime,
  promoteDirectory,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
