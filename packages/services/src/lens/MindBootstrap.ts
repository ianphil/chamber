// MindBootstrap — seed default Lens views and install Chamber-managed skills into a mind directory.
// Extracted from ViewDiscovery to keep scan() side-effect-free.

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../logger';

const log = Logger.create('MindBootstrap');
const LENS_SKILL_VERSION = '2.0.0';
const MANAGED_SKILL_METADATA = '.chamber-skill.json';
const MANAGED_SKILL_HASH_ALGORITHM = 'sha256-framed-v2';
const KNOWN_UNVERSIONED_LENS_SKILL_HASHES = new Set([
  '1f263ca4285fef4c9b497ab42a286bd246ff2dfdbd0c3170101db9f2c92d23e3',
  '716367d40a6fa9a5a6980437ac5a4bac25118e439ccf1b70e2b21d735c0d84da',
]);

export interface ManagedSkillManifest {
  name: string;
  version: string;
  assetRoot: string;
  files: string[];
  capabilities: string[];
}

const LENS_SKILL_MANIFEST: ManagedSkillManifest = {
  name: 'lens',
  version: LENS_SKILL_VERSION,
  assetRoot: 'lens-skill',
  files: ['SKILL.md'],
  capabilities: ['lens-json', 'canvas-lens', 'chamber-theme-v1'],
};

const TTASKS_SKILL_MANIFEST: ManagedSkillManifest = {
  name: 'ttasks',
  version: '0.3.0',
  assetRoot: 'ttasks-skill',
  files: [
    'SKILL.md',
    'reference/api.md',
    'reference/state-machine.md',
    'patterns/agent-tasks.md',
    'patterns/custom-types.md',
    'patterns/workflow-shapes.md',
  ],
  capabilities: ['ttasks-ts', 'task-graphs', 'workflow-orchestration'],
};

const AUTOMATION_SKILL_MANIFEST: ManagedSkillManifest = {
  name: 'automation',
  version: '2.2.0',
  assetRoot: 'automation-skill',
  files: ['SKILL.md', 'examples/briefing-with-canvas.ts'],
  capabilities: ['chamber-automation', 'cron-scripts', 'ttasks-runtime'],
};

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
  for (const manifest of [LENS_SKILL_MANIFEST, TTASKS_SKILL_MANIFEST, AUTOMATION_SKILL_MANIFEST]) {
    try {
      installManagedSkill(mindPath, manifest);
    } catch (error) {
      log.warn(`Managed skill install failed for ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function installLensSkill(mindPath: string): void {
  installManagedSkill(mindPath, LENS_SKILL_MANIFEST);
}

export function installManagedSkill(mindPath: string, manifest: ManagedSkillManifest): void {
  const asset = readManagedSkillAsset(manifest);
  if (!asset) return;

  const skillDir = path.join(mindPath, '.github', 'skills', manifest.name);
  const skillPath = path.join(skillDir, manifest.files[0]);
  const metadataPath = path.join(skillDir, MANAGED_SKILL_METADATA);

  if (!fs.existsSync(skillPath)) {
    log.info(`Installing ${manifest.name} skill into mind`);
    writeManagedSkill(skillDir, metadataPath, manifest, asset);
    return;
  }

  const metadata = readManagedSkillMetadata(metadataPath, manifest.name);
  if (metadata?.managedBy === 'chamber') {
    const state = getInstalledManagedSkillState(skillDir, metadata);
    if (state === 'modified') {
      log.warn(`${manifest.name} skill has local edits; skipping managed upgrade`);
      return;
    }

    if (
      state === 'incomplete'
      || compareVersions(metadata.version, manifest.version) < 0
      || !sameManagedFiles(metadata.files, asset.files)
    ) {
      log.info(`Upgrading ${manifest.name} skill from ${metadata.version} to ${manifest.version}`);
      writeManagedSkill(skillDir, metadataPath, manifest, asset, metadata.files);
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

function readManagedSkillAsset(manifest: ManagedSkillManifest): ManagedSkillAsset | null {
  if (manifest.files.length === 0 || manifest.files.some((file) => !isManagedSkillRelativePath(file))) {
    log.warn(`${manifest.name} skill manifest has unsafe file paths, skipping install`);
    return null;
  }

  const root = resolveManagedSkillAssetRoot(manifest);
  if (!root) {
    log.warn(`${manifest.name} skill asset not found, skipping install`);
    return null;
  }

  for (const file of manifest.files) {
    if (!fs.existsSync(path.join(root, file))) {
      log.warn(`${manifest.name} skill asset is missing ${file}, skipping install`);
      return null;
    }
  }

  const files = manifest.files.map((filePath) => {
    const content = fs.readFileSync(path.join(root, filePath));
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    return { path: filePath, content: buffer, sha256: sha256ManagedFile(filePath, buffer) };
  });

  return {
    root,
    files,
  };
}

function resolveManagedSkillAssetRoot(manifest: ManagedSkillManifest): string | null {
  // Lookup order:
  //   1-2. Packaged Electron — Forge places assets under `process.resourcesPath`.
  //   3.   Dev — running from the repo root via `npm start`, `npm test`, etc.
  // Source-relative paths (e.g. `__dirname` / `import.meta.url`) are deliberately
  // omitted: services is `"type": "module"` so `__dirname` is undefined in the
  // ESM bundle, and `import.meta.url` is rejected by CJS-mode TS loaders such
  // as Playwright's. The cwd fallback covers every dev scenario.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  const candidates = [
    path.join(resourcesPath, 'assets', manifest.assetRoot),
    path.join(resourcesPath, manifest.assetRoot),
    path.join(process.cwd(), 'apps', 'desktop', 'src', 'main', 'assets', manifest.assetRoot),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, manifest.files[0]))) {
      return candidate;
    }
  }

  return null;
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
  previousFiles: ManagedSkillFileMetadata[] = [],
): void {
  fs.mkdirSync(skillDir, { recursive: true });

  for (const file of asset.files) {
    const destination = path.join(skillDir, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content);
  }

  const nextFilePaths = new Set(asset.files.map((file) => file.path));
  for (const file of previousFiles) {
    if (!nextFilePaths.has(file.path)) {
      fs.rmSync(path.join(skillDir, file.path), { force: true });
    }
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

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
