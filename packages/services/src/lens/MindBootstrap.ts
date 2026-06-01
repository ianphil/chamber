// MindBootstrap — seed default Lens views and install Chamber-managed skills into a mind directory.
// Extracted from ViewDiscovery to keep scan() side-effect-free.

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../logger';

const log = Logger.create('MindBootstrap');
const MANAGED_SKILLS_ROOT = 'managed-skills';
const MANAGED_SKILL_METADATA = '.chamber-skill.json';
const MANAGED_SKILL_HASH_ALGORITHM = 'sha256-framed-v2';
const KNOWN_UNVERSIONED_LENS_SKILL_HASHES = new Set([
  '1f263ca4285fef4c9b497ab42a286bd246ff2dfdbd0c3170101db9f2c92d23e3',
  '716367d40a6fa9a5a6980437ac5a4bac25118e439ccf1b70e2b21d735c0d84da',
]);

const MANAGED_SKILL_CAPABILITIES: Record<string, string[]> = {
  lens: ['lens-json', 'canvas-lens', 'chamber-theme-v1'],
  ttasks: ['ttasks-ts', 'task-graphs', 'workflow-orchestration'],
  automation: ['chamber-automation', 'cron-scripts', 'ttasks-runtime'],
};

export interface ManagedSkillManifest {
  name: string;
  version: string;
  capabilities: string[];
}

export function seedLensDefaults(mindPath: string): void {
  const lensDir = path.join(mindPath, '.github', 'lens');

  // Hello World
  const helloDir = path.join(lensDir, 'hello-world');
  const helloViewJson = path.join(helloDir, 'view.json');
  if (!fs.existsSync(helloViewJson)) {
    log.info('Seeding default hello-world view');
    fs.mkdirSync(helloDir, { recursive: true });
    fs.writeFileSync(helloViewJson, JSON.stringify({
      name: 'Hello World',
      icon: 'zap',
      view: 'form',
      source: 'data.json',
      prompt: 'Report your current status including: your agent name, the mind directory name, how many files are in inbox/, how many initiatives exist, how many domains exist, and what extensions are loaded. Write the result as a flat JSON object to the path specified below.',
      refreshOn: 'click',
      schema: {
        properties: {
          agent: { type: 'string', title: 'Agent' },
          mind: { type: 'string', title: 'Mind' },
          inbox_count: { type: 'number', title: 'Inbox Items' },
          initiatives: { type: 'number', title: 'Initiatives' },
          domains: { type: 'number', title: 'Domains' },
          extensions: { type: 'string', title: 'Extensions' },
          status: { type: 'string', title: 'Status' },
        },
      },
    }, null, 2));
  }

  // Newspaper
  const newsDir = path.join(lensDir, 'newspaper');
  const newsViewJson = path.join(newsDir, 'view.json');
  if (!fs.existsSync(newsViewJson)) {
    log.info('Seeding default newspaper view');
    fs.mkdirSync(newsDir, { recursive: true });
    fs.writeFileSync(newsViewJson, JSON.stringify({
      name: 'Newspaper',
      icon: 'newspaper',
      view: 'briefing',
      source: 'briefing.json',
      prompt: 'Generate a morning briefing for this mind. Count inbox/ items, list active initiatives with their status and next actions, count domains, and note any recent changes. Write the result as a flat JSON object to the path specified below.',
      refreshOn: 'click',
      schema: {
        properties: {
          inbox_items: { type: 'number', title: 'Inbox Items' },
          active_initiatives: { type: 'number', title: 'Active Initiatives' },
          domains: { type: 'number', title: 'Domains' },
          top_priorities: { type: 'string', title: 'Top Priorities' },
          recent_changes: { type: 'string', title: 'Recent Changes' },
          status: { type: 'string', title: 'Overall Status' },
        },
      },
    }, null, 2));
  }
}

export function bootstrapMindCapabilities(mindPath: string): void {
  seedLensDefaults(mindPath);
  for (const asset of discoverManagedSkillAssets()) {
    try {
      installManagedSkillAsset(mindPath, asset);
    } catch (error) {
      log.warn(`Managed skill install failed for ${asset.manifest.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function installLensSkill(mindPath: string): void {
  const asset = discoverManagedSkillAssets().find(({ manifest }) => manifest.name === 'lens');
  if (asset) installManagedSkillAsset(mindPath, asset);
}

export function installManagedSkill(mindPath: string, skillRoot: string): void {
  const asset = readManagedSkillAsset(skillRoot);
  if (!asset) return;
  installManagedSkillAsset(mindPath, asset);
}

function installManagedSkillAsset(mindPath: string, asset: ManagedSkillAsset): void {
  const { manifest } = asset;
  const skillDir = path.join(mindPath, '.github', 'skills', manifest.name);
  const skillPath = path.join(skillDir, 'SKILL.md');
  const metadataPath = path.join(skillDir, MANAGED_SKILL_METADATA);

  if (!fs.existsSync(skillPath)) {
    log.info(`Installing ${manifest.name} skill into mind`);
    writeManagedSkill(skillDir, metadataPath, manifest, asset);
    return;
  }

  const metadata = readManagedSkillMetadata(metadataPath, manifest.name);
  if (metadata?.managedBy === 'chamber') {
    const state = getInstalledManagedSkillState(skillDir, metadata);

    if (
      state === 'incomplete'
      || state === 'modified'
      || metadata.version !== manifest.version
      || !sameManagedFiles(metadata.files, asset.files)
    ) {
      log.info(`Upgrading ${manifest.name} skill from ${metadata.version} to ${manifest.version}`);
      fs.rmSync(skillDir, { recursive: true, force: true });
      writeManagedSkill(skillDir, metadataPath, manifest, asset);
    }
    return;
  }

  if (manifest.name === 'lens') {
    const installedContent = fs.readFileSync(skillPath, 'utf-8');
    const installedSha256 = sha256Text(installedContent);

    if (KNOWN_UNVERSIONED_LENS_SKILL_HASHES.has(installedSha256)) {
      log.info(`Migrating unversioned Lens skill to ${manifest.version}`);
      writeManagedSkill(skillDir, metadataPath, manifest, asset);
      return;
    }

    if (isLegacyBundledLensSkill(installedContent)) {
      log.info(`Upgrading legacy Lens skill to ${manifest.version}`);
      backupLegacyLensSkill(skillDir, installedContent);
      writeManagedSkill(skillDir, metadataPath, manifest, asset);
      return;
    }
  }

  log.warn(`${manifest.name} skill is unmanaged; skipping install to preserve local edits`);
}

function backupLegacyLensSkill(skillDir: string, installedContent: string): void {
  const baseBackupPath = path.join(skillDir, 'SKILL.legacy-backup.md');
  let backupPath = baseBackupPath;
  for (let index = 1; fs.existsSync(backupPath); index += 1) {
    backupPath = path.join(skillDir, `SKILL.legacy-backup-${index}.md`);
  }
  fs.writeFileSync(backupPath, installedContent);
}

function discoverManagedSkillAssets(): ManagedSkillAsset[] {
  const root = resolveManagedSkillsRoot();
  if (!root) {
    log.warn('Managed skills asset root not found, skipping managed skill install');
    return [];
  }

  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readManagedSkillAsset(path.join(root, entry.name)))
      .filter((asset): asset is ManagedSkillAsset => asset !== null)
      .sort((left, right) => compareText(left.manifest.name, right.manifest.name));
  } catch (error) {
    log.warn(`Failed to read managed skills asset root: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function readManagedSkillAsset(root: string): ManagedSkillAsset | null {
  const skillPath = path.join(root, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    log.warn(`Managed skill asset at ${root} is missing SKILL.md, skipping install`);
    return null;
  }

  const skillContent = fs.readFileSync(skillPath, 'utf-8');
  const frontmatter = parseSkillFrontmatter(skillContent);
  if (!frontmatter) {
    log.warn(`Managed skill asset at ${root} has invalid SKILL.md frontmatter, skipping install`);
    return null;
  }

  const files = listManagedSkillFiles(root);
  if (files.length === 0 || !files.some((file) => file.path === 'SKILL.md')) {
    log.warn(`${frontmatter.name} skill has no installable files, skipping install`);
    return null;
  }

  return {
    root,
    manifest: {
      name: frontmatter.name,
      version: frontmatter.version,
      capabilities: MANAGED_SKILL_CAPABILITIES[frontmatter.name] ?? [],
    },
    files,
  };
}

function resolveManagedSkillsRoot(): string | null {
  // Lookup order:
  //   1-2. Packaged Electron — Forge places assets under `process.resourcesPath`.
  //   3.   Dev — running from the repo root via `npm start`, `npm test`, etc.
  // Source-relative paths (e.g. `__dirname` / `import.meta.url`) are deliberately
  // omitted: services is `"type": "module"` so `__dirname` is undefined in the
  // ESM bundle, and `import.meta.url` is rejected by CJS-mode TS loaders such
  // as Playwright's. The cwd fallback covers every dev scenario.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  const candidates = [
    path.join(resourcesPath, 'assets', MANAGED_SKILLS_ROOT),
    path.join(resourcesPath, MANAGED_SKILLS_ROOT),
    path.join(process.cwd(), 'apps', 'desktop', 'src', 'main', 'assets', MANAGED_SKILLS_ROOT),
  ];

  for (const candidate of candidates) {
    try {
      fs.readdirSync(candidate, { withFileTypes: true });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function listManagedSkillFiles(root: string): ManagedSkillAssetFile[] {
  const files: ManagedSkillAssetFile[] = [];

  function walk(relativeDir: string): void {
    const absoluteDir = path.join(root, relativeDir);
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }
      if (!entry.isFile() || !isManagedSkillRelativePath(relativePath) || isIgnoredManagedSkillAsset(relativePath)) {
        continue;
      }
      const content = fs.readFileSync(path.join(root, relativePath));
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
      files.push({ path: relativePath, content: buffer, sha256: sha256ManagedFile(relativePath, buffer) });
    }
  }

  walk('');
  return files.sort((left, right) => compareText(left.path, right.path));
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseSkillFrontmatter(content: string): Pick<ManagedSkillManifest, 'name' | 'version'> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return null;
  const metadata = normalized.slice(4, end).split('\n');
  const values = new Map<string, string>();
  for (const line of metadata) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1], match[2].replace(/^["']|["']$/g, '').trim());
  }
  const name = values.get('name');
  const version = values.get('version');
  if (!name || !version) return null;
  return { name, version };
}

function getInstalledManagedSkillState(
  skillDir: string,
  metadata: ManagedSkillMetadata,
): 'unmodified' | 'modified' | 'incomplete' {
  if (metadata.files.length === 0) return 'incomplete';

  for (const file of metadata.files) {
    const installedPath = path.join(skillDir, file.path);
    if (!fs.existsSync(installedPath)) return 'incomplete';
    const content = fs.readFileSync(installedPath);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    const installedSha256 = metadata.algorithm === 'sha256-legacy-single-file'
      ? sha256Buffer(buffer)
      : sha256ManagedFile(file.path, buffer);
    if (installedSha256 !== file.sha256) return 'modified';
  }

  return 'unmodified';
}

function readManagedSkillMetadata(metadataPath: string, expectedName: string): ManagedSkillMetadata | null {
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Partial<ManagedSkillMetadata> & Partial<LegacyManagedSkillMetadata>;
    if (
      parsed.name === expectedName
      && parsed.managedBy === 'chamber'
      && typeof parsed.version === 'string'
      && Array.isArray(parsed.capabilities)
    ) {
      if (
        parsed.algorithm === MANAGED_SKILL_HASH_ALGORITHM
        && Array.isArray(parsed.files)
        && parsed.files.every((file) => (
          typeof file?.path === 'string'
          && isManagedSkillRelativePath(file.path)
          && typeof file?.sha256 === 'string'
        ))
      ) {
        return parsed as ManagedSkillMetadata;
      }

      if (typeof parsed.contentSha256 === 'string') {
        return {
          name: parsed.name,
          version: parsed.version,
          managedBy: 'chamber',
          algorithm: 'sha256-legacy-single-file',
          files: [{ path: 'SKILL.md', sha256: parsed.contentSha256 }],
          capabilities: parsed.capabilities,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function writeManagedSkill(
  skillDir: string,
  metadataPath: string,
  manifest: ManagedSkillManifest,
  asset: ManagedSkillAsset,
): void {
  fs.mkdirSync(skillDir, { recursive: true });

  for (const file of asset.files) {
    const destination = path.join(skillDir, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content);
  }

  const metadata: ManagedSkillMetadata = {
    name: manifest.name,
    version: manifest.version,
    managedBy: 'chamber',
    algorithm: MANAGED_SKILL_HASH_ALGORITHM,
    files: asset.files.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 })),
    capabilities: manifest.capabilities,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}

function sameManagedFiles(left: ManagedSkillFileMetadata[], right: ManagedSkillAssetFile[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => file.path === right[index]?.path && file.sha256 === right[index]?.sha256);
}

function isManagedSkillRelativePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes('\\')) return false;
  if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) return false;
  const normalized = path.posix.normalize(filePath);
  return normalized === filePath && normalized !== '..' && !normalized.startsWith('../');
}

function isIgnoredManagedSkillAsset(filePath: string): boolean {
  const baseName = path.posix.basename(filePath);
  return baseName === MANAGED_SKILL_METADATA || /^SKILL\.legacy-backup(?:-\d+)?\.md$/.test(baseName);
}

function isLegacyBundledLensSkill(content: string): boolean {
  const normalized = content.toLowerCase();
  return content.includes('name: lens')
    && !content.includes('version:')
    && normalized.includes('.github/lens')
    && normalized.includes('form')
    && normalized.includes('table')
    && normalized.includes('briefing')
    && !normalized.includes('canvas lens');
}

interface ManagedSkillFileMetadata {
  path: string;
  sha256: string;
}

interface ManagedSkillMetadata {
  name: string;
  version: string;
  managedBy: 'chamber';
  algorithm: typeof MANAGED_SKILL_HASH_ALGORITHM | 'sha256-legacy-single-file';
  files: ManagedSkillFileMetadata[];
  capabilities: string[];
}

interface LegacyManagedSkillMetadata {
  name: string;
  version: string;
  managedBy: 'chamber';
  contentSha256: string;
  capabilities: string[];
}

interface ManagedSkillAssetFile extends ManagedSkillFileMetadata {
  content: Buffer;
}

interface ManagedSkillAsset {
  root: string;
  manifest: ManagedSkillManifest;
  files: ManagedSkillAssetFile[];
}

function sha256Buffer(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function sha256ManagedFile(filePath: string, content: Buffer): string {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(String(content.byteLength))
    .update('\0')
    .update(content)
    .update('\0')
    .digest('hex');
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
