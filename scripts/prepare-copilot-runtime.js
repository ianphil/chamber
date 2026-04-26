/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestDir = path.join(repoRoot, 'chamber-copilot-runtime');
const targetDir = path.join(repoRoot, 'resources', 'copilot-runtime');
const stagingDir = path.join(repoRoot, 'resources', 'copilot-runtime.new');
const backupDir = path.join(repoRoot, 'resources', 'copilot-runtime.old');

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported Copilot runtime platform: ${platform}`);
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }
  throw new Error(`Unsupported Copilot runtime arch: ${arch}`);
}

function getPlatformPackageName(platform, arch) {
  return `@github/copilot-${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

function getPlatformBinaryName(platform) {
  return normalizePlatform(platform) === 'win32' ? 'copilot.exe' : 'copilot';
}

function getPlatformBinaryPath(modulesDir, platform, arch) {
  return path.join(
    modulesDir,
    '@github',
    getPlatformPackageName(platform, arch).split('/')[1],
    getPlatformBinaryName(platform),
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readExactDependencyVersion(packageJsonPath, packageName) {
  const pkg = readJson(packageJsonPath);
  const version = pkg.dependencies?.[packageName];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Expected ${packageName} in ${packageJsonPath} to be pinned to an exact version. Found: ${String(version)}`
    );
  }
  return version;
}

function readRequiredVersions(runtimeManifestRoot = manifestDir) {
  const packageJsonPath = path.join(runtimeManifestRoot, 'package.json');
  return {
    sdk: readExactDependencyVersion(packageJsonPath, '@github/copilot-sdk'),
    cli: readExactDependencyVersion(packageJsonPath, '@github/copilot'),
  };
}

function readInstalledVersion(modulesDir, packageName) {
  const packageJsonPath = path.join(modulesDir, ...packageName.split('/'), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing ${packageName} package metadata at ${packageJsonPath}`);
  }
  const pkg = readJson(packageJsonPath);
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`Invalid ${packageName} package metadata at ${packageJsonPath}`);
  }
  return pkg.version;
}

function assertHostMatchesTarget(targetPlatform, targetArch) {
  const normalizedTargetPlatform = normalizePlatform(targetPlatform);
  const normalizedTargetArch = normalizeArch(targetArch);
  if (normalizedTargetPlatform !== normalizePlatform(process.platform)
      || normalizedTargetArch !== normalizeArch(process.arch)) {
    throw new Error(
      `Cross-compiling the Copilot runtime is unsupported. `
      + `Host=${process.platform}-${process.arch} target=${normalizedTargetPlatform}-${normalizedTargetArch}.`
    );
  }
}

function assertOptionalDependenciesEnabled() {
  const omit = String(process.env.npm_config_omit || '');
  const omitted = omit.split(/[,\s]+/).filter(Boolean);
  if (omitted.includes('optional')) {
    throw new Error('Preparing the Copilot runtime requires optional dependencies. Remove npm_config_omit=optional.');
  }
  if (String(process.env.npm_config_optional || '').toLowerCase() === 'false') {
    throw new Error('Preparing the Copilot runtime requires optional dependencies. Remove npm_config_optional=false.');
  }
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
      encoding: options.encoding,
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });
  }

  return spawnSync(command, args, {
    stdio: options.stdio,
    encoding: options.encoding,
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

function runCommandCapture(command, args, options = {}) {
  const result = spawnCommand(command, args, {
    encoding: 'utf-8',
    cwd: options.cwd,
    env: options.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`.trim()
    );
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function copyRuntimeManifest(destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.copyFileSync(path.join(manifestDir, 'package.json'), path.join(destinationRoot, 'package.json'));
  fs.copyFileSync(path.join(manifestDir, 'package-lock.json'), path.join(destinationRoot, 'package-lock.json'));
}

function validateRuntimeDir(runtimeRoot, targetPlatform, targetArch, requiredVersions = readRequiredVersions()) {
  const modulesDir = path.join(runtimeRoot, 'node_modules');
  const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
  const cliLoader = path.join(modulesDir, '@github', 'copilot', 'npm-loader.js');
  const platformPackageName = getPlatformPackageName(targetPlatform, targetArch);
  const binaryPath = getPlatformBinaryPath(modulesDir, targetPlatform, targetArch);

  const installedSdkVersion = readInstalledVersion(modulesDir, '@github/copilot-sdk');
  const installedCliVersion = readInstalledVersion(modulesDir, '@github/copilot');
  const installedPlatformVersion = readInstalledVersion(modulesDir, platformPackageName);

  if (installedSdkVersion !== requiredVersions.sdk) {
    throw new Error(
      `Packaged Copilot SDK version mismatch. Expected ${requiredVersions.sdk}, found ${installedSdkVersion}.`
    );
  }
  if (installedCliVersion !== requiredVersions.cli) {
    throw new Error(
      `Packaged Copilot CLI version mismatch. Expected ${requiredVersions.cli}, found ${installedCliVersion}.`
    );
  }
  if (installedPlatformVersion !== requiredVersions.cli) {
    throw new Error(
      `Packaged Copilot platform binary version mismatch. Expected ${requiredVersions.cli}, found ${installedPlatformVersion}.`
    );
  }
  if (!fs.existsSync(sdkEntry)) {
    throw new Error(`Packaged Copilot SDK entry not found at ${sdkEntry}`);
  }
  if (!fs.existsSync(cliLoader)) {
    throw new Error(`Packaged Copilot CLI loader not found at ${cliLoader}`);
  }
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Packaged Copilot CLI binary not found at ${binaryPath}`);
  }

  if (normalizePlatform(targetPlatform) !== 'win32') {
    const stat = fs.statSync(binaryPath);
    if ((stat.mode & 0o111) === 0) {
      throw new Error(`Packaged Copilot CLI binary is not executable: ${binaryPath}`);
    }
  }

  return {
    modulesDir,
    sdkEntry,
    cliLoader,
    binaryPath,
    platformPackageName,
    installedSdkVersion,
    installedCliVersion,
    installedPlatformVersion,
  };
}

function smokeTestRuntime(binaryPath, expectedCliVersion) {
  const output = runCommandCapture(binaryPath, ['--version']);
  if (!output.includes(expectedCliVersion)) {
    throw new Error(
      `Copilot CLI smoke test output did not include ${expectedCliVersion}. Output: ${output.trim()}`
    );
  }
}

function promoteRuntime() {
  fs.rmSync(backupDir, { recursive: true, force: true });

  let movedExistingTarget = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      movedExistingTarget = true;
    }

    fs.renameSync(stagingDir, targetDir);
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    if (movedExistingTarget && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir);
    }
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function prepareCopilotRuntime({ targetPlatform, targetArch }) {
  const normalizedPlatform = normalizePlatform(targetPlatform);
  const normalizedArch = normalizeArch(targetArch);
  const requiredVersions = readRequiredVersions();

  assertHostMatchesTarget(normalizedPlatform, normalizedArch);
  assertOptionalDependenciesEnabled();

  if (fs.existsSync(targetDir)) {
    try {
      const existing = validateRuntimeDir(targetDir, normalizedPlatform, normalizedArch, requiredVersions);
      smokeTestRuntime(existing.binaryPath, requiredVersions.cli);
      console.log(
        `[CopilotRuntime] Existing runtime is ready sdk=${existing.installedSdkVersion} `
        + `cli=${existing.installedCliVersion} target=${normalizedPlatform}-${normalizedArch}`
      );
      return existing;
    } catch (error) {
      console.warn(`[CopilotRuntime] Refreshing existing runtime: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  copyRuntimeManifest(stagingDir);

  runCommand(getNpmCommand(), [
    'ci',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
  ], {
    cwd: stagingDir,
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_optional: 'true',
    },
  });

  const prepared = validateRuntimeDir(stagingDir, normalizedPlatform, normalizedArch, requiredVersions);
  smokeTestRuntime(prepared.binaryPath, requiredVersions.cli);
  promoteRuntime();

  console.log(
    `[CopilotRuntime] Packaged runtime ready sdk=${prepared.installedSdkVersion} `
    + `cli=${prepared.installedCliVersion} target=${normalizedPlatform}-${normalizedArch}`
  );

  return prepared;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      args.targetPlatform = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--arch') {
      args.targetArch = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return args;
}

function main() {
  const { targetPlatform = process.platform, targetArch = process.arch } = parseArgs(process.argv.slice(2));
  prepareCopilotRuntime({ targetPlatform, targetArch });
}

module.exports = {
  assertHostMatchesTarget,
  getPlatformBinaryPath,
  getPlatformPackageName,
  prepareCopilotRuntime,
  readRequiredVersions,
  validateRuntimeDir,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
