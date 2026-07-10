import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_SKILL_DIRECTORIES,
  MAX_SKILL_MARKDOWN_BYTES,
  MindSkillDiscovery,
} from './MindSkillDiscovery';

describe('MindSkillDiscovery', () => {
  let tmp: string;
  let outsidePath: string;
  let mindPath: string;
  let skillsDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-skills-'));
    outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-skills-outside-'));
    mindPath = tmp;
    skillsDir = path.join(mindPath, '.github', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outsidePath, { recursive: true, force: true });
  });

  function addSkill(name: string, frontmatter: string, body: string = '# Body\n'): void {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  }

  it('returns [] when no skills directory exists', async () => {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    await expect(new MindSkillDiscovery().list(mindPath)).resolves.toEqual([]);
  });

  it('returns [] when the skills directory is empty', async () => {
    await expect(new MindSkillDiscovery().list(mindPath)).resolves.toEqual([]);
  });

  it('reads name, version, and description from frontmatter', async () => {
    addSkill('automation', 'name: automation\nversion: 2.3.0\ndescription: "Run cron jobs."');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([
      { id: 'automation', name: 'automation', version: '2.3.0', description: 'Run cron jobs.' },
    ]);
  });

  it('returns a fallback manifest when SKILL.md is missing', async () => {
    fs.mkdirSync(path.join(skillsDir, 'orphan'), { recursive: true });
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([{ id: 'orphan', name: 'orphan' }]);
  });

  it('falls back to the directory id when frontmatter is missing entirely', async () => {
    const dir = path.join(skillsDir, 'plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Just a body\n');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([{ id: 'plain', name: 'plain' }]);
  });

  it('falls back to the directory id when the name field is blank', async () => {
    addSkill('blank-name', 'name:   \nversion: 1.0.0');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([{ id: 'blank-name', name: 'blank-name', version: '1.0.0' }]);
  });

  it('parses frontmatter after one UTF-8 BOM', async () => {
    const dir = path.join(skillsDir, 'bom-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '\uFEFF---\nname: BOM Skill\nversion: 1.2.3\ndescription: "BOM metadata"\n---\n# Body\n',
    );

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toEqual([
      { id: 'bom-skill', name: 'BOM Skill', version: '1.2.3', description: 'BOM metadata' },
    ]);
  });

  it('sorts skills by stable on-disk id', async () => {
    addSkill('zebra', 'name: Alpha');
    addSkill('alpha', 'name: Zebra');
    addSkill('mango', 'name: Mango');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills.map((skill) => skill.id)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('lists all skills at the direct-directory limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let index = 0; index < MAX_SKILL_DIRECTORIES; index += 1) {
      fs.mkdirSync(path.join(skillsDir, `skill-${String(index).padStart(3, '0')}`));
    }

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toHaveLength(MAX_SKILL_DIRECTORIES);
    expect(skills.at(-1)?.id).toBe('skill-255');
    expect(warn).not.toHaveBeenCalled();
  });

  it('deterministically truncates and logs when direct directories exceed the limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let index = MAX_SKILL_DIRECTORIES; index >= 0; index -= 1) {
      fs.mkdirSync(path.join(skillsDir, `skill-${String(index).padStart(3, '0')}`));
    }

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toHaveLength(MAX_SKILL_DIRECTORIES);
    expect(skills[0].id).toBe('skill-000');
    expect(skills.at(-1)?.id).toBe('skill-255');
    expect(skills.map((skill) => skill.id)).not.toContain('skill-256');
    expect(warn).toHaveBeenCalledWith(
      '[MindSkillDiscovery]',
      expect.stringContaining('257 skill directories'),
    );
  });

  it('returns fallback metadata and logs when SKILL.md exceeds the byte limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = '---\nname: unbounded\nversion: 9.9.9\n---\n';
    const dir = path.join(skillsDir, 'oversized');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      prefix + 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1 - Buffer.byteLength(prefix)),
    );

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toEqual([{ id: 'oversized', name: 'oversized' }]);
    expect(warn).toHaveBeenCalledWith(
      '[MindSkillDiscovery]',
      expect.stringContaining(`exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte limit`),
    );
  });

  it('reads metadata when SKILL.md is exactly at the byte limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = '---\nname: exact-limit\nversion: 1.0.0\n---\n';
    const dir = path.join(skillsDir, 'exact-limit');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      prefix + 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES - Buffer.byteLength(prefix)),
    );

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toEqual([{ id: 'exact-limit', name: 'exact-limit', version: '1.0.0' }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns fallback metadata and logs when SKILL.md is not a regular file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = path.join(skillsDir, 'unreadable');
    fs.mkdirSync(path.join(dir, 'SKILL.md'), { recursive: true });

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toEqual([{ id: 'unreadable', name: 'unreadable' }]);
    expect(warn).toHaveBeenCalledWith(
      '[MindSkillDiscovery]',
      expect.stringContaining('is not a regular file'),
    );
  });

  it('ignores files at the top level of the skills directory', async () => {
    fs.writeFileSync(path.join(skillsDir, 'README.md'), '# notes');
    addSkill('real', 'name: real');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills.map((s) => s.id)).toEqual(['real']);
  });

  it.skipIf(process.platform === 'win32')('excludes POSIX directory symlinks', async () => {
    addSkillAt(outsidePath, 'outside');
    fs.symlinkSync(outsidePath, path.join(skillsDir, 'linked'), 'dir');

    await expect(new MindSkillDiscovery().list(mindPath)).resolves.toEqual([]);
  });

  it.skipIf(process.platform !== 'win32')('excludes Windows directory junctions', async () => {
    addSkillAt(outsidePath, 'outside');
    fs.symlinkSync(outsidePath, path.join(skillsDir, 'linked'), 'junction');

    await expect(new MindSkillDiscovery().list(mindPath)).resolves.toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('does not read metadata through a symlinked SKILL.md', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = path.join(skillsDir, 'linked-file');
    const outsideSkill = path.join(outsidePath, 'SKILL.md');
    fs.mkdirSync(dir);
    fs.writeFileSync(outsideSkill, '---\nname: outside\nversion: 9.9.9\n---\n');
    fs.symlinkSync(outsideSkill, path.join(dir, 'SKILL.md'), 'file');

    const skills = await new MindSkillDiscovery().list(mindPath);

    expect(skills).toEqual([{ id: 'linked-file', name: 'linked-file' }]);
    expect(warn).toHaveBeenCalledWith(
      '[MindSkillDiscovery]',
      expect.stringContaining('cannot be a symbolic link'),
    );
  });

  it('folds continuation lines into a single description value', async () => {
    addSkill('multiline', 'name: multiline\ndescription: "first half\n  and a continuation"');
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills[0].description).toBe('first half and a continuation');
  });

  it('strips single quotes around scalar values', async () => {
    addSkill('quoted', "name: 'q-name'\ndescription: 'q-desc'");
    const skills = await new MindSkillDiscovery().list(mindPath);
    expect(skills[0]).toEqual({ id: 'quoted', name: 'q-name', description: 'q-desc' });
  });

  function addSkillAt(directory: string, name: string): void {
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
});
