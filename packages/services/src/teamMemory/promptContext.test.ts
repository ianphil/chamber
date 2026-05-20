import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildTeamMemoryContext } from './promptContext';

describe('buildTeamMemoryContext', () => {
  let mindPath: string;

  beforeEach(() => {
    mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-team-mem-'));
  });

  afterEach(() => {
    fs.rmSync(mindPath, { recursive: true, force: true });
  });

  it('returns null when .chamber/team/ does not exist', () => {
    expect(buildTeamMemoryContext(mindPath)).toBeNull();
  });

  it('returns null when the team dir exists but rules and decisions are both empty', () => {
    writeTeamFile('rules.md', '   \n\n  ');
    writeTeamFile('decisions.md', '');
    expect(buildTeamMemoryContext(mindPath)).toBeNull();
  });

  it('returns a rules-only block when only rules.md has content', () => {
    writeTeamFile('rules.md', '- Always cite sources.\n- Never delete user files without confirmation.');

    const block = buildTeamMemoryContext(mindPath);

    expect(block).not.toBeNull();
    expect(block).toContain('<team_memory>');
    expect(block).toContain('<rules>');
    expect(block).toContain('- Always cite sources.');
    expect(block).toContain('- Never delete user files without confirmation.');
    expect(block).not.toContain('<recent_decisions>');
    expect(block!.endsWith('</team_memory>')).toBe(true);
  });

  it('returns a decisions-only block when only decisions.md has content', () => {
    writeTeamFile('decisions.md', '## 2026-05-19\nUse PostgreSQL for the metadata store.');

    const block = buildTeamMemoryContext(mindPath);

    expect(block).not.toBeNull();
    expect(block).toContain('<recent_decisions>');
    expect(block).toContain('Use PostgreSQL for the metadata store.');
    expect(block).not.toContain('<rules>');
  });

  it('returns both sections when both files have content, with rules before decisions', () => {
    writeTeamFile('rules.md', 'Always run lint before push.');
    writeTeamFile('decisions.md', '## 2026-05-19\nPicked vitest over jest.');

    const block = buildTeamMemoryContext(mindPath);

    expect(block).not.toBeNull();
    const rulesIdx = block!.indexOf('<rules>');
    const decisionsIdx = block!.indexOf('<recent_decisions>');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(decisionsIdx).toBeGreaterThan(rulesIdx);
  });

  it('takes the most recent N decision entries (newest at end of file)', () => {
    const journal = [
      '## 2026-05-15',
      'oldest decision',
      '',
      '## 2026-05-16',
      'middle decision',
      '',
      '## 2026-05-17',
      'newest decision',
    ].join('\n');
    writeTeamFile('decisions.md', journal);

    const block = buildTeamMemoryContext(mindPath, { maxDecisions: 2 });

    expect(block).not.toBeNull();
    expect(block).toContain('newest decision');
    expect(block).toContain('middle decision');
    expect(block).not.toContain('oldest decision');
  });

  it('orders kept decisions newest-first in the output', () => {
    const journal = [
      '## 2026-05-16',
      'middle decision',
      '',
      '## 2026-05-17',
      'newest decision',
    ].join('\n');
    writeTeamFile('decisions.md', journal);

    const block = buildTeamMemoryContext(mindPath);

    expect(block).not.toBeNull();
    const newestIdx = block!.indexOf('newest decision');
    const middleIdx = block!.indexOf('middle decision');
    expect(newestIdx).toBeGreaterThan(-1);
    expect(middleIdx).toBeGreaterThan(newestIdx);
  });

  it('treats decisions without H2 headings as a single entry', () => {
    writeTeamFile('decisions.md', 'Just a free-form note, no headings.\nSecond line of the same entry.');

    const block = buildTeamMemoryContext(mindPath);

    expect(block).not.toBeNull();
    expect(block).toContain('Just a free-form note, no headings.');
    expect(block).toContain('Second line of the same entry.');
  });

  it('drops oldest decisions first when over the byte budget; never splits a decision entry', () => {
    const longBody = (label: string) => `${label} ${'x'.repeat(200)}`;
    const journal = [
      `## 2026-05-15\n${longBody('OLD')}`,
      `## 2026-05-16\n${longBody('MID')}`,
      `## 2026-05-17\n${longBody('NEW')}`,
    ].join('\n\n');
    writeTeamFile('decisions.md', journal);

    const block = buildTeamMemoryContext(mindPath, { maxBytes: 350 });

    expect(block).not.toBeNull();
    expect(block).toContain('NEW xxxxx');
    expect(block).not.toContain('OLD ');
    // The kept entry was included intact (not truncated mid-body).
    expect(block).toContain('x'.repeat(200));
  });

  it('keeps all rules even when the rules content alone exceeds the byte budget', () => {
    const bigRules = `- ${'r'.repeat(8000)}`;
    writeTeamFile('rules.md', bigRules);
    writeTeamFile('decisions.md', '## 2026-05-17\ndropped decision');

    const block = buildTeamMemoryContext(mindPath, { maxBytes: 1024 });

    expect(block).not.toBeNull();
    expect(block).toContain('r'.repeat(8000));
    expect(block).not.toContain('dropped decision');
  });

  it('is idempotent: same inputs produce identical output', () => {
    writeTeamFile('rules.md', 'Always be kind.');
    writeTeamFile('decisions.md', '## 2026-05-17\nAdopted ESM everywhere.');

    const first = buildTeamMemoryContext(mindPath);
    const second = buildTeamMemoryContext(mindPath);

    expect(first).toBe(second);
  });

  function writeTeamFile(name: string, contents: string): void {
    const teamDir = path.join(mindPath, '.chamber', 'team');
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(path.join(teamDir, name), contents, 'utf-8');
  }
});
