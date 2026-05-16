/* eslint-disable no-console */
/**
 * CHANGELOG.md parser + writer for Chamber's Model B release flow.
 *
 * The single source of truth for:
 *   - reading the `## Unreleased` section and the conventional `### Headings`
 *     it contains,
 *   - recommending the next stable version bump (patch / minor / major) from
 *     those headings,
 *   - promoting `## Unreleased` into `## vX.Y.Z (YYYY-MM-DD)` at stable
 *     release time.
 *
 * This module is consumed by:
 *   - scripts/bump-insiders-version.js  (computes the target stable + counter)
 *   - scripts/append-changelog-entry.js (ship-time bullet append)
 *   - .github/skills/release/           (post-stable promote)
 *   - tests/regression/changelog-parser.test.ts
 */

const fs = require('node:fs');

const UNRELEASED_HEADING = 'Unreleased';

// Precedence: higher number wins. Headings are matched case-insensitively
// against the leading word of the `### Heading`. Anything not listed defaults
// to patch precedence so unknown sections never block a release.
const HEADING_PRECEDENCE = {
  breaking: { rank: 3, bump: 'major' },
  features: { rank: 2, bump: 'minor' },
  feature: { rank: 2, bump: 'minor' },
  fixes: { rank: 1, bump: 'patch' },
  fix: { rank: 1, bump: 'patch' },
  performance: { rank: 1, bump: 'patch' },
  perf: { rank: 1, bump: 'patch' },
  refactor: { rank: 1, bump: 'patch' },
  docs: { rank: 1, bump: 'patch' },
  documentation: { rank: 1, bump: 'patch' },
  tests: { rank: 1, bump: 'patch' },
  test: { rank: 1, bump: 'patch' },
  build: { rank: 1, bump: 'patch' },
  ci: { rank: 1, bump: 'patch' },
  chore: { rank: 1, bump: 'patch' },
  release: { rank: 1, bump: 'patch' },
};

function normalizeHeading(raw) {
  return raw.trim().toLowerCase().split(/\s+/)[0];
}

/**
 * Read `## Unreleased` and return its contents.
 *
 * @param {string} changelogPath
 * @returns {{
 *   present: boolean,            // true if `## Unreleased` exists at all
 *   raw: string,                 // the section body (without the `## Unreleased` heading)
 *   headings: string[],          // normalized headings found inside, in order
 *   bulletCount: number,         // total `- ` bullets across all subsections
 *   startLine: number,           // 0-indexed line of the `## Unreleased` heading
 *   endLine: number              // 0-indexed line just past the last line of the section
 * }}
 */
function readUnreleasedSection(changelogPath) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const startLine = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line));
  if (startLine === -1) {
    return { present: false, raw: '', headings: [], bulletCount: 0, startLine: -1, endLine: -1 };
  }
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      endLine = i;
      break;
    }
  }
  const body = lines.slice(startLine + 1, endLine);
  const headings = [];
  let bulletCount = 0;
  for (const line of body) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      headings.push(normalizeHeading(headingMatch[1]));
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      bulletCount += 1;
    }
  }
  return {
    present: true,
    raw: body.join('\n'),
    headings,
    bulletCount,
    startLine,
    endLine,
  };
}

/**
 * Recommend a SemVer bump (patch / minor / major) from the headings inside
 * `## Unreleased`. Returns null if there are no actionable entries — the
 * release skill treats null as "block dispatch".
 *
 * @param {string[]} headings — normalized headings from readUnreleasedSection
 * @returns {'patch' | 'minor' | 'major' | null}
 */
function recommendBump(headings) {
  if (!headings || headings.length === 0) return null;
  let best = null;
  for (const heading of headings) {
    const entry = HEADING_PRECEDENCE[heading] ?? HEADING_PRECEDENCE.chore;
    if (!best || entry.rank > best.rank) best = entry;
  }
  return best ? best.bump : null;
}

/**
 * Convenience: read + recommend in one call.
 *
 * @param {string} changelogPath
 * @returns {{
 *   bump: 'patch' | 'minor' | 'major' | null,
 *   section: ReturnType<typeof readUnreleasedSection>
 * }}
 */
function recommendBumpFromChangelog(changelogPath) {
  const section = readUnreleasedSection(changelogPath);
  if (!section.present || section.bulletCount === 0) {
    return { bump: null, section };
  }
  return { bump: recommendBump(section.headings), section };
}

/**
 * Replace `## Unreleased` with `## v<version> (<dateISO>)` and leave a fresh
 * empty `## Unreleased` placeholder at the top. Idempotent if Unreleased is
 * missing — returns false instead of throwing.
 *
 * @param {string} changelogPath
 * @param {string} version — bare SemVer (no `v` prefix)
 * @param {string} dateISO — `YYYY-MM-DD`
 * @returns {boolean} true if the file was rewritten
 */
function promoteUnreleasedToVersion(changelogPath, version, dateISO) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const startLine = lines.findIndex((line) => /^##\s+Unreleased\s*$/i.test(line));
  if (startLine === -1) return false;
  const newSection = ['## Unreleased', '', `## v${version} (${dateISO})`];
  const rewritten = [...lines.slice(0, startLine), ...newSection, ...lines.slice(startLine + 1)];
  fs.writeFileSync(changelogPath, rewritten.join('\n'));
  return true;
}

/**
 * Ensure `## Unreleased` exists at the top of CHANGELOG.md, immediately after
 * the `# Changelog` H1. Idempotent; returns true if a section was inserted.
 *
 * @param {string} changelogPath
 * @returns {boolean}
 */
function ensureUnreleasedSection(changelogPath) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => /^##\s+Unreleased\s*$/i.test(line))) return false;
  const h1Line = lines.findIndex((line) => /^#\s+/.test(line));
  const insertAt = h1Line === -1 ? 0 : h1Line + 1;
  const newLines = [...lines.slice(0, insertAt), '', '## Unreleased', '', ...lines.slice(insertAt)];
  fs.writeFileSync(changelogPath, newLines.join('\n'));
  return true;
}

/**
 * Append a bullet under the right `### Heading` of `## Unreleased`,
 * creating the section and the heading if either is missing.
 *
 * @param {string} changelogPath
 * @param {{ kind: string, summary: string, detail?: string, issue?: string }} entry
 *   kind: one of the conventional heading words (features, fixes, breaking, ...)
 *   summary: bold one-liner without the surrounding `**`
 *   detail: optional explanatory text
 *   issue: optional issue number (no `#`)
 * @returns {void}
 */
function appendEntry(changelogPath, { kind, summary, detail, issue }) {
  if (!kind) throw new Error('appendEntry: kind is required');
  if (!summary) throw new Error('appendEntry: summary is required');
  ensureUnreleasedSection(changelogPath);
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const section = readUnreleasedSection(changelogPath);

  const headingWord = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
  const headingRegex = new RegExp(`^###\\s+${headingWord}\\s*$`, 'i');

  let headingLine = -1;
  for (let i = section.startLine + 1; i < section.endLine; i += 1) {
    if (headingRegex.test(lines[i])) {
      headingLine = i;
      break;
    }
  }

  const bulletParts = [`**${summary}**`];
  if (detail) bulletParts.push(detail.trim());
  let bullet = `- ${bulletParts.join(' — ')}`;
  if (issue) bullet += ` (#${issue})`;

  if (headingLine === -1) {
    const insertAt = section.endLine;
    const block = ['', `### ${headingWord}`, '', bullet];
    const updated = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)];
    fs.writeFileSync(changelogPath, updated.join('\n'));
    return;
  }

  let insertAt = headingLine + 1;
  while (insertAt < section.endLine && lines[insertAt].trim() === '') insertAt += 1;
  while (insertAt < section.endLine && /^\s*-\s+/.test(lines[insertAt])) insertAt += 1;
  const updated = [...lines.slice(0, insertAt), bullet, ...lines.slice(insertAt)];
  fs.writeFileSync(changelogPath, updated.join('\n'));
}

module.exports = {
  UNRELEASED_HEADING,
  HEADING_PRECEDENCE,
  readUnreleasedSection,
  recommendBump,
  recommendBumpFromChangelog,
  promoteUnreleasedToVersion,
  ensureUnreleasedSection,
  appendEntry,
};
