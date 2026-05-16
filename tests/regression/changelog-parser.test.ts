import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readUnreleasedSection,
  recommendBump,
  recommendBumpFromChangelog,
  promoteUnreleasedToVersion,
  ensureUnreleasedSection,
  appendEntry,
} from '../../scripts/changelog';

const CHANGELOG_NAME = 'CHANGELOG.md';

function writeChangelog(dir: string, body: string): string {
  const path = join(dir, CHANGELOG_NAME);
  writeFileSync(path, body);
  return path;
}

describe('changelog parser', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'changelog-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports absent when no Unreleased section exists', () => {
    const path = writeChangelog(workDir, '# Changelog\n\n## v1.0.0 (2025-01-01)\n');
    const section = readUnreleasedSection(path);
    expect(section.present).toBe(false);
    expect(section.bulletCount).toBe(0);
  });

  it('parses headings and counts bullets inside Unreleased', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Features',
        '',
        '- **Add X** — detail',
        '- **Add Y** — detail',
        '',
        '### Fixes',
        '',
        '- **Fix Z** — detail',
        '',
        '## v1.0.0 (2025-01-01)',
        '',
      ].join('\n'),
    );
    const section = readUnreleasedSection(path);
    expect(section.present).toBe(true);
    expect(section.headings).toEqual(['features', 'fixes']);
    expect(section.bulletCount).toBe(3);
  });

  it('stops reading at the next ## heading', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Fixes',
        '',
        '- **In unreleased** — yes',
        '',
        '## v1.0.0 (2025-01-01)',
        '',
        '### Features',
        '',
        '- **In v1.0.0, not Unreleased** — must not count',
      ].join('\n'),
    );
    const section = readUnreleasedSection(path);
    expect(section.headings).toEqual(['fixes']);
    expect(section.bulletCount).toBe(1);
  });

  it('recommends patch for fixes-only sections', () => {
    expect(recommendBump(['fixes'])).toBe('patch');
    expect(recommendBump(['fixes', 'docs', 'tests'])).toBe('patch');
  });

  it('recommends minor when any feature is present', () => {
    expect(recommendBump(['features'])).toBe('minor');
    expect(recommendBump(['fixes', 'features'])).toBe('minor');
  });

  it('recommends major when any breaking is present', () => {
    expect(recommendBump(['breaking'])).toBe('major');
    expect(recommendBump(['fixes', 'features', 'breaking'])).toBe('major');
  });

  it('returns null for empty headings list', () => {
    expect(recommendBump([])).toBeNull();
    expect(recommendBump(undefined as unknown as string[])).toBeNull();
  });

  it('treats unknown headings as patch precedence', () => {
    expect(recommendBump(['chore'])).toBe('patch');
    expect(recommendBump(['mystery-section'])).toBe('patch');
  });

  it('recommendBumpFromChangelog returns null when Unreleased exists but has no bullets', () => {
    const path = writeChangelog(
      workDir,
      ['# Changelog', '', '## Unreleased', '', '## v1.0.0 (2025-01-01)', ''].join('\n'),
    );
    const { bump } = recommendBumpFromChangelog(path);
    expect(bump).toBeNull();
  });

  it('promoteUnreleasedToVersion replaces Unreleased and leaves a fresh placeholder', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Features',
        '',
        '- **Add X** — detail',
        '',
        '## v1.0.0 (2025-01-01)',
        '',
      ].join('\n'),
    );
    const changed = promoteUnreleasedToVersion(path, '1.1.0', '2025-02-01');
    expect(changed).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## Unreleased');
    expect(text).toContain('## v1.1.0 (2025-02-01)');
    expect(text.indexOf('## Unreleased')).toBeLessThan(text.indexOf('## v1.1.0'));
    expect(text.indexOf('## v1.1.0')).toBeLessThan(text.indexOf('- **Add X**'));
    expect(text.indexOf('- **Add X**')).toBeLessThan(text.indexOf('## v1.0.0'));
  });

  it('ensureUnreleasedSection inserts the section just after the H1 when missing', () => {
    const path = writeChangelog(workDir, '# Changelog\n\n## v1.0.0 (2025-01-01)\n');
    const inserted = ensureUnreleasedSection(path);
    expect(inserted).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text.indexOf('## Unreleased')).toBeLessThan(text.indexOf('## v1.0.0'));
  });

  it('ensureUnreleasedSection is idempotent', () => {
    const path = writeChangelog(
      workDir,
      ['# Changelog', '', '## Unreleased', '', '## v1.0.0', ''].join('\n'),
    );
    const inserted = ensureUnreleasedSection(path);
    expect(inserted).toBe(false);
  });

  it('appendEntry creates Unreleased, the heading, and the bullet on a clean changelog', () => {
    const path = writeChangelog(workDir, '# Changelog\n\n## v1.0.0 (2025-01-01)\n');
    appendEntry(path, { kind: 'fixes', summary: 'Bug fix', detail: 'detail here', issue: '42' });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## Unreleased');
    expect(text).toContain('### Fixes');
    expect(text).toContain('- **Bug fix** — detail here (#42)');
  });

  it('appendEntry adds a bullet under the existing heading without duplicating it', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Fixes',
        '',
        '- **First fix** — old',
        '',
        '## v1.0.0 (2025-01-01)',
      ].join('\n'),
    );
    appendEntry(path, { kind: 'fixes', summary: 'Second fix' });
    const text = readFileSync(path, 'utf8');
    const matches = text.match(/^### Fixes$/gm) ?? [];
    expect(matches.length).toBe(1);
    expect(text).toContain('- **First fix** — old');
    expect(text).toContain('- **Second fix**');
    expect(text.indexOf('- **First fix**')).toBeLessThan(text.indexOf('- **Second fix**'));
  });

  it('appendEntry adds a new heading for a kind not yet present', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Fixes',
        '',
        '- **First fix** — old',
        '',
        '## v1.0.0',
      ].join('\n'),
    );
    appendEntry(path, { kind: 'features', summary: 'New feature' });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('### Fixes');
    expect(text).toContain('### Features');
    expect(text).toContain('- **New feature**');
  });
});
