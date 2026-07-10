import { constants as fsConstants, type Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { SkillManifest } from '@chamber/shared/types';
import { Logger } from '../logger';

export const MAX_SKILL_DIRECTORIES = 256;
export const MAX_SKILL_MARKDOWN_BYTES = 512_000;

const SKILL_MARKDOWN_FILENAME = 'SKILL.md';
const OPEN_READ_NOFOLLOW_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const log = Logger.create('MindSkillDiscovery');

/**
 * Reads self-declared display metadata from skill directories on disk.
 *
 * This service does not invoke skills, modify them, or establish managed-skill
 * provenance, integrity, installation, or update state.
 */
export class MindSkillDiscovery {
  /**
   * Lists at most 256 direct skill directories in stable directory-id order.
   * Missing or unreadable SKILL.md files fall back to the directory id.
   */
  async list(mindPath: string): Promise<SkillManifest[]> {
    const skillsDir = path.join(mindPath, '.github', 'skills');
    const resolvedSkillsDir = await resolveSkillsDirectory(mindPath, skillsDir);
    if (!resolvedSkillsDir) return [];

    let entries: Dirent[];
    try {
      entries = await fs.readdir(resolvedSkillsDir, { withFileTypes: true });
    } catch (error) {
      logReadFailure(`skills directory ${resolvedSkillsDir}`, error);
      return [];
    }

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareText(left.name, right.name));

    if (directories.length > MAX_SKILL_DIRECTORIES) {
      log.warn(
        `Found ${directories.length} skill directories in ${resolvedSkillsDir}; `
        + `listing the first ${MAX_SKILL_DIRECTORIES} in stable directory-id order. `
        + 'The remaining directories were not inspected.',
      );
    }

    const skills: SkillManifest[] = [];
    for (const entry of directories.slice(0, MAX_SKILL_DIRECTORIES)) {
      const manifest = await readSkillManifest(resolvedSkillsDir, entry.name);
      if (manifest) skills.push(manifest);
    }
    return skills;
  }
}

interface ParsedFrontmatter {
  name: string;
  version?: string;
  description?: string;
}

async function resolveSkillsDirectory(mindPath: string, skillsDir: string): Promise<string | null> {
  try {
    const [resolvedMindPath, skillsStat] = await Promise.all([
      fs.realpath(mindPath),
      fs.lstat(skillsDir),
    ]);
    if (!skillsStat.isDirectory() || skillsStat.isSymbolicLink()) {
      log.warn(`Skills path ${skillsDir} is not a direct directory`);
      return null;
    }

    const resolvedSkillsDir = await fs.realpath(skillsDir);
    if (!isWithin(resolvedMindPath, resolvedSkillsDir)) {
      log.warn(`Skills directory ${skillsDir} resolves outside the mind directory`);
      return null;
    }
    return resolvedSkillsDir;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logReadFailure(`skills directory ${skillsDir}`, error);
    }
    return null;
  }
}

async function readSkillManifest(
  resolvedSkillsDir: string,
  id: string,
): Promise<SkillManifest | null> {
  const skillDir = path.join(resolvedSkillsDir, id);
  let resolvedSkillDir: string;
  try {
    const skillDirStat = await fs.lstat(skillDir);
    if (!skillDirStat.isDirectory() || skillDirStat.isSymbolicLink()) {
      log.warn(`Skill path ${skillDir} is not a direct directory`);
      return null;
    }
    resolvedSkillDir = await fs.realpath(skillDir);
    if (path.dirname(resolvedSkillDir) !== resolvedSkillsDir) {
      log.warn(`Skill directory ${skillDir} resolves outside the skills directory`);
      return null;
    }
  } catch (error) {
    logReadFailure(`skill directory ${skillDir}`, error);
    return null;
  }

  const raw = await readSkillMarkdown(resolvedSkillDir);
  if (raw === null) return { id, name: id };

  const parsed = parseFrontmatter(raw);
  return {
    id,
    name: parsed.name || id,
    ...(parsed.version ? { version: parsed.version } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
  };
}

async function readSkillMarkdown(resolvedSkillDir: string): Promise<string | null> {
  const skillMarkdownPath = path.join(resolvedSkillDir, SKILL_MARKDOWN_FILENAME);
  try {
    const markdownStat = await fs.lstat(skillMarkdownPath);
    if (markdownStat.isSymbolicLink()) {
      log.warn(`${skillMarkdownPath} cannot be a symbolic link`);
      return null;
    }
    if (!markdownStat.isFile()) {
      log.warn(`${skillMarkdownPath} is not a regular file`);
      return null;
    }
    if (markdownStat.size > MAX_SKILL_MARKDOWN_BYTES) {
      log.warn(`${skillMarkdownPath} exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte limit`);
      return null;
    }

    const resolvedMarkdownPath = await fs.realpath(skillMarkdownPath);
    if (path.dirname(resolvedMarkdownPath) !== resolvedSkillDir) {
      log.warn(`${skillMarkdownPath} resolves outside its skill directory`);
      return null;
    }

    const handle = await fs.open(resolvedMarkdownPath, OPEN_READ_NOFOLLOW_FLAGS);
    try {
      return await readBoundedUtf8(handle, skillMarkdownPath);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logReadFailure(skillMarkdownPath, error);
    }
    return null;
  }
}

async function readBoundedUtf8(handle: FileHandle, displayPath: string): Promise<string | null> {
  const openedStat = await handle.stat();
  if (!openedStat.isFile()) {
    log.warn(`${displayPath} is not a regular file`);
    return null;
  }
  if (openedStat.size > MAX_SKILL_MARKDOWN_BYTES) {
    log.warn(`${displayPath} exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte limit`);
    return null;
  }

  const buffer = Buffer.alloc(MAX_SKILL_MARKDOWN_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > MAX_SKILL_MARKDOWN_BYTES) {
    log.warn(`${displayPath} exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte limit`);
    return null;
  }
  return buffer.subarray(0, offset).toString('utf8');
}

/**
 * Parses the bounded scalar subset of SKILL.md frontmatter used for display.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: '' };

  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (currentKey && /^\s+\S/.test(line)) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ''} ${line.trim()}`);
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) {
      currentKey = null;
      continue;
    }
    currentKey = kv[1];
    fields.set(currentKey, kv[2].trim());
  }

  for (const [key, value] of fields) fields.set(key, stripQuotes(value));

  const name = fields.get('name') ?? '';
  const version = fields.get('version');
  const description = fields.get('description');
  return {
    name,
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
  };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length === 0
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function logReadFailure(target: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`Failed to read ${target}: ${message}`);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
