// MindSkillDiscovery — reads the SKILL.md frontmatter under
// <mindPath>/.github/skills/<name>/ for every skill installed on a mind.
//
// This is renderer-facing metadata only: it powers the "Skills" list on the
// chat About panel so users can see what an agent can do without dropping
// into the mind's filesystem. The actual skill-execution flow lives in the
// SDK runtime; this file does not invoke skills, modify them, or replace
// any of the existing skill-management services.

import * as fs from 'fs';
import * as path from 'path';
import type { SkillManifest } from '@chamber/shared/types';
import { Logger } from '../logger';

const log = Logger.create('MindSkillDiscovery');

export class MindSkillDiscovery {
  /**
   * Scan `<mindPath>/.github/skills` and return one SkillManifest per
   * subdirectory containing a SKILL.md. Skills missing the file (or with
   * unreadable frontmatter) are returned with just the directory name.
   * Returns an empty array if the skills directory does not exist.
   */
  list(mindPath: string): SkillManifest[] {
    const skillsDir = path.join(mindPath, '.github', 'skills');
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        log.warn(`Failed to read skills directory ${skillsDir}: ${(err as Error)?.message}`);
      }
      return [];
    }

    const skills: SkillManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      const manifest = this.readSkillManifest(entry.name, skillMdPath);
      if (manifest) skills.push(manifest);
    }
    // Stable alphabetical order so the UI doesn't shuffle between scans.
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  private readSkillManifest(id: string, skillMdPath: string): SkillManifest {
    let raw: string;
    try {
      // SKILL.md frontmatter sits in the first ~30 lines; reading the full
      // file is fine because skills are small and called rarely.
      raw = fs.readFileSync(skillMdPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        log.warn(`Failed to read ${skillMdPath}: ${(err as Error)?.message}`);
      }
      return { id, name: id };
    }
    return { id, ...parseFrontmatter(raw) };
  }
}

interface ParsedFrontmatter {
  name: string;
  version?: string;
  description?: string;
}

/**
 * Minimal YAML frontmatter parser tailored to the SKILL.md shape:
 *   ---
 *   name: foo
 *   version: 1.2.3
 *   description: "single-line summary"
 *   ---
 *
 * We deliberately don't pull in a YAML library here -- skill frontmatter is
 * deeply constrained by the lens/automation skill author guidelines, and the
 * three fields we surface are always simple scalars. Multi-line values are
 * folded into one line, surrounding quotes are stripped.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: '' };

  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    // Continuation lines for folded scalars start with whitespace.
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

  // Strip enclosing quote pair AFTER folding so multi-line "..." values
  // come out clean.
  for (const [k, v] of fields) fields.set(k, stripQuotes(v));

  const name = fields.get('name') ?? '';
  const version = fields.get('version');
  const description = fields.get('description');
  return {
    name,
    version: version && version.length > 0 ? version : undefined,
    description: description && description.length > 0 ? description : undefined,
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
