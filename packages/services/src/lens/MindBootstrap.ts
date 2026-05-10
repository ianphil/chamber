// MindBootstrap — seed default Lens views and install the Lens skill into a mind directory.
// Extracted from ViewDiscovery to keep scan() side-effect-free.

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../logger';

const log = Logger.create('MindBootstrap');
const LENS_SKILL_VERSION = '2.0.0';
const LENS_SKILL_METADATA = '.chamber-skill.json';
const KNOWN_UNVERSIONED_LENS_SKILL_HASHES = new Set([
  '1f263ca4285fef4c9b497ab42a286bd246ff2dfdbd0c3170101db9f2c92d23e3',
  '716367d40a6fa9a5a6980437ac5a4bac25118e439ccf1b70e2b21d735c0d84da',
]);

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
  installLensSkill(mindPath);
}

export function installLensSkill(mindPath: string): void {
  const skillDir = path.join(mindPath, '.github', 'skills', 'lens');
  const skillPath = path.join(skillDir, 'SKILL.md');
  const metadataPath = path.join(skillDir, LENS_SKILL_METADATA);
  const content = readBundledLensSkill();

  if (!content) {
    log.warn('Lens skill asset not found, skipping install');
    return;
  }

  const contentSha256 = sha256(content);
  if (!fs.existsSync(skillPath)) {
    log.info('Installing Lens skill into mind');
    writeManagedLensSkill(skillDir, skillPath, metadataPath, content, contentSha256);
    return;
  }

  const installedContent = fs.readFileSync(skillPath, 'utf-8');
  const installedSha256 = sha256(installedContent);
  const metadata = readLensSkillMetadata(metadataPath);

  if (metadata?.managedBy === 'chamber') {
    if (metadata.contentSha256 !== installedSha256) {
      log.warn('Lens skill has local edits; skipping managed upgrade');
      return;
    }

    if (compareVersions(metadata.version, LENS_SKILL_VERSION) < 0 || installedSha256 !== contentSha256) {
      log.info(`Upgrading Lens skill from ${metadata.version} to ${LENS_SKILL_VERSION}`);
      writeManagedLensSkill(skillDir, skillPath, metadataPath, content, contentSha256);
    }
    return;
  }

  if (KNOWN_UNVERSIONED_LENS_SKILL_HASHES.has(installedSha256)) {
    log.info(`Migrating unversioned Lens skill to ${LENS_SKILL_VERSION}`);
    writeManagedLensSkill(skillDir, skillPath, metadataPath, content, contentSha256);
    return;
  }

  if (isLegacyBundledLensSkill(installedContent)) {
    log.info(`Upgrading legacy Lens skill to ${LENS_SKILL_VERSION}`);
    backupLegacyLensSkill(skillDir, installedContent);
    writeManagedLensSkill(skillDir, skillPath, metadataPath, content, contentSha256);
    return;
  }

  log.warn('Lens skill is unmanaged; skipping install to preserve local edits');
}

function backupLegacyLensSkill(skillDir: string, installedContent: string): void {
  const baseBackupPath = path.join(skillDir, 'SKILL.legacy-backup.md');
  let backupPath = baseBackupPath;
  for (let index = 1; fs.existsSync(backupPath); index += 1) {
    backupPath = path.join(skillDir, `SKILL.legacy-backup-${index}.md`);
  }
  fs.writeFileSync(backupPath, installedContent);
}

function readBundledLensSkill(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
  const candidates = [
    path.join(resourcesPath, 'assets', 'lens-skill', 'SKILL.md'),
    path.join(resourcesPath, 'lens-skill', 'SKILL.md'),
    path.join(__dirname, '..', 'assets', 'lens-skill', 'SKILL.md'),
    path.join(__dirname, '..', '..', 'src', 'main', 'assets', 'lens-skill', 'SKILL.md'),
    path.join(process.cwd(), 'apps', 'desktop', 'src', 'main', 'assets', 'lens-skill', 'SKILL.md'),
  ];

  let content: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8');
      break;
    }
  }

  return content;
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

interface LensSkillMetadata {
  name: string;
  version: string;
  managedBy: 'chamber';
  contentSha256: string;
  capabilities: string[];
}

function readLensSkillMetadata(metadataPath: string): LensSkillMetadata | null {
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Partial<LensSkillMetadata>;
    if (
      parsed.name === 'lens'
      && parsed.managedBy === 'chamber'
      && typeof parsed.version === 'string'
      && typeof parsed.contentSha256 === 'string'
      && Array.isArray(parsed.capabilities)
    ) {
      return parsed as LensSkillMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

function writeManagedLensSkill(
  skillDir: string,
  skillPath: string,
  metadataPath: string,
  content: string,
  contentSha256: string,
): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, content);
  fs.writeFileSync(metadataPath, JSON.stringify({
    name: 'lens',
    version: LENS_SKILL_VERSION,
    managedBy: 'chamber',
    contentSha256,
    capabilities: ['lens-json', 'canvas-lens', 'chamber-theme-v1'],
  }, null, 2) + '\n');
}

function sha256(content: string): string {
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
