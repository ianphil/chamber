import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MindSkillDiscovery } from './MindSkillDiscovery';

describe('MindSkillDiscovery', () => {
  let tmp: string;
  let mindPath: string;
  let skillsDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-skills-'));
    mindPath = tmp;
    skillsDir = path.join(mindPath, '.github', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function addSkill(name: string, frontmatter: string, body: string = '# Body\n'): void {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  }

  it('returns [] when no skills directory exists', () => {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    expect(new MindSkillDiscovery().list(mindPath)).toEqual([]);
  });

  it('returns [] when the skills directory is empty', () => {
    expect(new MindSkillDiscovery().list(mindPath)).toEqual([]);
  });

  it('reads name, version, and description from frontmatter', () => {
    addSkill('automation', 'name: automation\nversion: 2.3.0\ndescription: "Run cron jobs."');
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([
      { id: 'automation', name: 'automation', version: '2.3.0', description: 'Run cron jobs.' },
    ]);
  });

  it('returns a fallback manifest when SKILL.md is missing', () => {
    fs.mkdirSync(path.join(skillsDir, 'orphan'), { recursive: true });
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([{ id: 'orphan', name: 'orphan' }]);
  });

  it('returns a fallback manifest when frontmatter is missing entirely', () => {
    const dir = path.join(skillsDir, 'plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Just a body\n');
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills).toEqual([{ id: 'plain', name: '' }]);
  });

  it('sorts skills alphabetically by name', () => {
    addSkill('zebra', 'name: zebra');
    addSkill('alpha', 'name: alpha');
    addSkill('mango', 'name: mango');
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('ignores files at the top level of the skills directory', () => {
    fs.writeFileSync(path.join(skillsDir, 'README.md'), '# notes');
    addSkill('real', 'name: real');
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills.map((s) => s.id)).toEqual(['real']);
  });

  it('folds continuation lines into a single description value', () => {
    addSkill('multiline', 'name: multiline\ndescription: "first half\n  and a continuation"');
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills[0].description).toBe('first half and a continuation');
  });

  it('strips single quotes around scalar values', () => {
    addSkill('quoted', "name: 'q-name'\ndescription: 'q-desc'");
    const skills = new MindSkillDiscovery().list(mindPath);
    expect(skills[0]).toEqual({ id: 'quoted', name: 'q-name', description: 'q-desc' });
  });
});
