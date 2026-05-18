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
    const path = writeChangelog(workDir, '# Changelog\n\n## [1.0.0] - 2025-01-01\n');
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
        '## [Unreleased]',
        '',
        '### Added',
        '',
        '- **Add X** — detail',
        '- **Add Y** — detail',
        '',
        '### Fixed',
        '',
        '- **Fix Z** — detail',
        '',
        '## [1.0.0] - 2025-01-01',
        '',
      ].join('\n'),
    );
    const section = readUnreleasedSection(path);
    expect(section.present).toBe(true);
    expect(section.headings).toEqual(['added', 'fixed']);
    expect(section.bulletCount).toBe(3);
  });

  it('parses legacy `## Unreleased` (no brackets) for back-compat', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Features',
        '',
        '- **Legacy feature** — pre-KaC bullet',
        '',
        '## v1.0.0 (2025-01-01)',
        '',
      ].join('\n'),
    );
    const section = readUnreleasedSection(path);
    expect(section.present).toBe(true);
    expect(section.headings).toEqual(['features']);
    expect(section.bulletCount).toBe(1);
  });

  it('stops reading at the next ## heading', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- **In unreleased** — yes',
        '',
        '## [1.0.0] - 2025-01-01',
        '',
        '### Added',
        '',
        '- **In v1.0.0, not Unreleased** — must not count',
      ].join('\n'),
    );
    const section = readUnreleasedSection(path);
    expect(section.headings).toEqual(['fixed']);
    expect(section.bulletCount).toBe(1);
  });

  it('recommends patch for fixed-only sections', () => {
    expect(recommendBump(['fixed'])).toBe('patch');
    expect(recommendBump(['fixed', 'docs', 'tests'])).toBe('patch');
    expect(recommendBump(['security'])).toBe('patch');
  });

  it('recommends minor when any added/changed/deprecated is present', () => {
    expect(recommendBump(['added'])).toBe('minor');
    expect(recommendBump(['changed'])).toBe('minor');
    expect(recommendBump(['deprecated'])).toBe('minor');
    expect(recommendBump(['fixed', 'added'])).toBe('minor');
  });

  it('recommends major when any removed or breaking is present', () => {
    expect(recommendBump(['removed'])).toBe('major');
    expect(recommendBump(['breaking'])).toBe('major');
    expect(recommendBump(['fixed', 'added', 'removed'])).toBe('major');
  });

  it('accepts legacy feature/fix aliases at the bump-recommend level', () => {
    expect(recommendBump(['features'])).toBe('minor');
    expect(recommendBump(['fixes'])).toBe('patch');
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
      ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2025-01-01', ''].join('\n'),
    );
    const { bump } = recommendBumpFromChangelog(path);
    expect(bump).toBeNull();
  });

  it('promoteUnreleasedToVersion writes the KaC `## [X.Y.Z] - date` format', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '### Added',
        '',
        '- **Add X** — detail',
        '',
        '## [1.0.0] - 2025-01-01',
        '',
      ].join('\n'),
    );
    const changed = promoteUnreleasedToVersion(path, '1.1.0', '2025-02-01');
    expect(changed).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## [Unreleased]');
    expect(text).toContain('## [1.1.0] - 2025-02-01');
    expect(text.indexOf('## [Unreleased]')).toBeLessThan(text.indexOf('## [1.1.0]'));
    expect(text.indexOf('## [1.1.0]')).toBeLessThan(text.indexOf('- **Add X**'));
    expect(text.indexOf('- **Add X**')).toBeLessThan(text.indexOf('## [1.0.0]'));
  });

  it('promoteUnreleasedToVersion accepts a legacy `## Unreleased` placeholder and rewrites in KaC form', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '### Features',
        '',
        '- **Legacy bullet** — detail',
        '',
        '## v1.0.0 (2025-01-01)',
        '',
      ].join('\n'),
    );
    const changed = promoteUnreleasedToVersion(path, '1.1.0', '2025-02-01');
    expect(changed).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## [Unreleased]');
    expect(text).toContain('## [1.1.0] - 2025-02-01');
    // The freshly-written Unreleased placeholder uses brackets even though
    // the previous heading was the legacy form.
    expect(text).not.toMatch(/^## Unreleased\s*$/m);
  });

  it('ensureUnreleasedSection inserts the section just after the H1 + annotation block when missing', () => {
    const path = writeChangelog(
      workDir,
      '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [1.0.0] - 2025-01-01\n',
    );
    const inserted = ensureUnreleasedSection(path);
    expect(inserted).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text.indexOf('## [Unreleased]')).toBeLessThan(text.indexOf('## [1.0.0]'));
    // Annotation prose must stay above [Unreleased].
    expect(text.indexOf('All notable changes')).toBeLessThan(text.indexOf('## [Unreleased]'));
  });

  it('ensureUnreleasedSection is idempotent (recognizes either old or new form as present)', () => {
    const newForm = writeChangelog(
      workDir,
      ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2025-01-01', ''].join('\n'),
    );
    expect(ensureUnreleasedSection(newForm)).toBe(false);

    const legacy = writeChangelog(
      workDir,
      ['# Changelog', '', '## Unreleased', '', '## v1.0.0 (2025-01-01)', ''].join('\n'),
    );
    expect(ensureUnreleasedSection(legacy)).toBe(false);
  });

  it('appendEntry creates Unreleased, the heading, and the bullet on a clean changelog', () => {
    const path = writeChangelog(workDir, '# Changelog\n\n## [1.0.0] - 2025-01-01\n');
    appendEntry(path, { kind: 'fixed', summary: 'Bug fix', detail: 'detail here', issue: '42' });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## [Unreleased]');
    expect(text).toContain('### Fixed');
    expect(text).toContain('- **Bug fix** — detail here (#42)');
  });

  it('appendEntry adds a bullet under the existing heading without duplicating it', () => {
    const path = writeChangelog(
      workDir,
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- **First fix** — old',
        '',
        '## [1.0.0] - 2025-01-01',
      ].join('\n'),
    );
    appendEntry(path, { kind: 'fixed', summary: 'Second fix' });
    const text = readFileSync(path, 'utf8');
    const matches = text.match(/^### Fixed$/gm) ?? [];
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
        '## [Unreleased]',
        '',
        '### Fixed',
        '',
        '- **First fix** — old',
        '',
        '## [1.0.0] - 2025-01-01',
      ].join('\n'),
    );
    appendEntry(path, { kind: 'added', summary: 'New feature' });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('### Fixed');
    expect(text).toContain('### Added');
    expect(text).toContain('- **New feature**');
  });

  it('appendEntry maps legacy feature/fix aliases to KaC canonical headings', () => {
    const path = writeChangelog(
      workDir,
      ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2025-01-01'].join('\n'),
    );
    appendEntry(path, { kind: 'fix', summary: 'Singular fix' });
    appendEntry(path, { kind: 'feature', summary: 'Singular feature' });
    appendEntry(path, { kind: 'perf', summary: 'Perf bump' });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('### Fixed');
    expect(text).toContain('### Added');
    expect(text).toContain('### Performance');
    expect(text).not.toMatch(/^### Fix\s*$/m);
    expect(text).not.toMatch(/^### Feature\s*$/m);
    expect(text).not.toMatch(/^### Fixes\s*$/m);
    expect(text).not.toMatch(/^### Features\s*$/m);
    expect(text).not.toMatch(/^### Perf\s*$/m);
  });

  it('appendEntry preserves a blank line between new section block and the next ## heading', () => {
    const path = writeChangelog(
      workDir,
      ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2025-01-01', '', '### Release', ''].join('\n'),
    );
    appendEntry(path, { kind: 'fix', summary: 'Patch' });
    const text = readFileSync(path, 'utf8');
    // The new ### Fixed block must not abut the next ## heading.
    expect(text).toMatch(/- \*\*Patch\*\*\n\n+## \[1\.0\.0\]/);
  });
});
