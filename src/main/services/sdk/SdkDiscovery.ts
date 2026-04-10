// SDK discovery — finding npm global prefix and global node_modules.

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const isWindows = process.platform === 'win32';

let cachedPrefix: string | null = null;

export function parseNpmrcPrefix(rcPath: string): string | null {
  try {
    const content = fs.readFileSync(rcPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*prefix\s*=\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch { /* not found */ }
  return null;
}

export function hasGlobalSdk(prefix: string): string | null {
  const modulesDir = isWindows
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');
  if (fs.existsSync(path.join(modulesDir, '@github', 'copilot-sdk', 'package.json'))) {
    return modulesDir;
  }
  return null;
}

export function getWellKnownPrefixes(): string[] {
  const home = os.homedir();
  const prefixes: string[] = [];

  if (isWindows) {
    const userPrefix = parseNpmrcPrefix(path.join(home, '.npmrc'));
    if (userPrefix) prefixes.push(userPrefix);

    for (const envKey of ['ProgramFiles', 'ProgramFiles(x86)'] as const) {
      const pf = process.env[envKey];
      if (pf) {
        const builtinRc = path.join(pf, 'nodejs', 'node_modules', 'npm', 'npmrc');
        const p = parseNpmrcPrefix(builtinRc);
        if (p) prefixes.push(p);
      }
    }

    if (process.env.APPDATA) {
      prefixes.push(path.join(process.env.APPDATA, 'npm'));
    }
  } else {
    prefixes.push('/usr/local', '/opt/homebrew', '/usr');

    const nvmDir = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        for (const v of versions) prefixes.push(path.join(nvmDir, v));
      } catch { /* ignore */ }
    }

    const voltaDir = path.join(home, '.volta', 'tools', 'image', 'node');
    if (fs.existsSync(voltaDir)) {
      try {
        const versions = fs.readdirSync(voltaDir).sort().reverse();
        for (const v of versions) prefixes.push(path.join(voltaDir, v));
      } catch { /* ignore */ }
    }
  }

  return prefixes;
}

export function getNpmGlobalPrefix(): string {
  if (cachedPrefix) return cachedPrefix;

  if (process.env.npm_config_prefix) {
    const envPrefix = process.env.npm_config_prefix;
    if (fs.existsSync(envPrefix)) {
      cachedPrefix = envPrefix;
      return cachedPrefix;
    }
  }

  try {
    cachedPrefix = execSync('npm prefix -g', { encoding: 'utf-8' }).trim();
    return cachedPrefix;
  } catch { /* npm not on PATH */ }

  for (const prefix of getWellKnownPrefixes()) {
    if (hasGlobalSdk(prefix)) {
      cachedPrefix = prefix;
      return cachedPrefix;
    }
  }

  throw new Error(
    'Could not find @github/copilot-sdk. Run: npm install -g @github/copilot-sdk'
  );
}

export function getGlobalNodeModules(): string {
  const prefix = getNpmGlobalPrefix();
  const modulesDir = isWindows
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');

  if (!fs.existsSync(path.join(modulesDir, '@github', 'copilot-sdk', 'package.json'))) {
    throw new Error(
      '@github/copilot-sdk is not installed globally. Run: npm install -g @github/copilot-sdk'
    );
  }
  return modulesDir;
}
