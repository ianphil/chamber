/* eslint-disable no-console */
/**
 * CHANGELOG.md parser + writer for Chamber's Model B release flow.
 *
 * Format: Keep a Changelog 1.1.0 (https://keepachangelog.com/en/1.1.0/).
 * `## [Unreleased]` placeholder + `## [X.Y.Z] - YYYY-MM-DD` versioned
 * sections. Legacy `## Unreleased` / `## vX.Y.Z (YYYY-MM-DD)` sections
 * written before the KaC migration are still parsed for back-compat.
 *
 * The single source of truth for:
 *   - reading the `## [Unreleased]` section and the conventional `### Headings`
 *     it contains,
 *   - recommending the next stable version bump (patch / minor / major) from
 *     those headings,
 *   - promoting `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD` at stable
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

// CHANGELOG.md follows the Keep a Changelog 1.1.0 format:
//   - `## [Unreleased]` placeholder at the top.
//   - Versioned sections `## [X.Y.Z] - YYYY-MM-DD` below.
//   - Sub-headings drawn from KaC's canonical vocabulary
//     (Added / Changed / Deprecated / Removed / Fixed / Security)
//     plus a `Breaking` heading kept as a Chamber extension because KaC
//     has no inherent breaking signal and we want a mechanical bump.
// Historical sections written before the migration use `## Unreleased`
// (no brackets) and `## vX.Y.Z (YYYY-MM-DD)`; the read paths in this
// module tolerate both formats indefinitely so we never have to rewrite
// frozen release history.

// Match `## Unreleased`, `## [Unreleased]`, or any case variation thereof.
const UNRELEASED_HEADING_RE = /^##\s+\[?Unreleased\]?\s*$/i;
// Match either the legacy `## v1.2.3 (2025-01-01)` or the KaC
// `## [1.2.3] - 2025-01-01` versioned heading.
const VERSION_HEADING_RE =
  /^##\s+(?:v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?\s*\(\d{4}-\d{2}-\d{2}\)|\[\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?\]\s*-\s*\d{4}-\d{2}-\d{2})\s*$/;

// Precedence: higher number wins. Headings are matched case-insensitively
// against the leading word of the `### Heading`. Anything not listed defaults
// to patch precedence so unknown sections never block a release.
const HEADING_PRECEDENCE = {
  // KaC canonical
  removed: { rank: 3, bump: 'major' },
  changed: { rank: 2, bump: 'minor' },
  added: { rank: 2, bump: 'minor' },
  deprecated: { rank: 2, bump: 'minor' },
  fixed: { rank: 1, bump: 'patch' },
  security: { rank: 1, bump: 'patch' },
  // Chamber extension: explicit Breaking heading. KaC has no inherent
  // breaking signal; keeping this lets the release skill detect a major
  // bump mechanically without scanning bullet text.
  breaking: { rank: 3, bump: 'major' },
  // Legacy aliases (pre-KaC migration). New tooling emits canonical
  // names, but parsing these keeps historical Unreleased state valid.
  features: { rank: 2, bump: 'minor' },
  feature: { rank: 2, bump: 'minor' },
  fixes: { rank: 1, bump: 'patch' },
  fix: { rank: 1, bump: 'patch' },
  // Chamber extensions kept as area-tagging sub-headings; all patch.
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
  packaging: { rank: 1, bump: 'patch' },
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
  const startLine = lines.findIndex((line) => UNRELEASED_HEADING_RE.test(line));
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
 * Replace `## [Unreleased]` with `## [<version>] - <dateISO>` (Keep a
 * Changelog 1.1.0 format) and leave a fresh empty `## [Unreleased]`
 * placeholder at the top. Tolerates a legacy `## Unreleased` heading
 * (no brackets) at read time; always writes the bracketed KaC form.
 * Idempotent if Unreleased is missing — returns false instead of
 * throwing.
 *
 * @param {string} changelogPath
 * @param {string} version — bare SemVer (no `v` prefix)
 * @param {string} dateISO — `YYYY-MM-DD`
 * @returns {boolean} true if the file was rewritten
 */
function promoteUnreleasedToVersion(changelogPath, version, dateISO) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const startLine = lines.findIndex((line) => UNRELEASED_HEADING_RE.test(line));
  if (startLine === -1) return false;
  const newSection = ['## [Unreleased]', '', `## [${version}] - ${dateISO}`];
  const rewritten = [...lines.slice(0, startLine), ...newSection, ...lines.slice(startLine + 1)];
  fs.writeFileSync(changelogPath, rewritten.join('\n'));
  return true;
}

/**
 * Ensure `## [Unreleased]` exists at the top of CHANGELOG.md, immediately
 * after the `# Changelog` H1 (and any KaC header annotation block).
 * Idempotent — also recognized as present if a legacy `## Unreleased`
 * heading is found; returns true only if a new section was inserted.
 *
 * @param {string} changelogPath
 * @returns {boolean}
 */
function ensureUnreleasedSection(changelogPath) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => UNRELEASED_HEADING_RE.test(line))) return false;
  const h1Line = lines.findIndex((line) => /^#\s+/.test(line));
  // Insert after the H1 and any contiguous non-heading prose lines that
  // follow it (KaC's standard "All notable changes…" annotation block),
  // stopping at the first `##` heading or end of file. This keeps the
  // header annotation above `## [Unreleased]`.
  let insertAt = h1Line === -1 ? 0 : h1Line + 1;
  while (insertAt < lines.length && !/^##\s+/.test(lines[insertAt])) {
    insertAt += 1;
  }
  const newLines = [
    ...lines.slice(0, insertAt),
    '## [Unreleased]',
    '',
    ...lines.slice(insertAt),
  ];
  fs.writeFileSync(changelogPath, newLines.join('\n'));
  return true;
}

// Map of accepted kind aliases to the canonical heading we render under
// `## [Unreleased]`. Keep a Changelog canonical names are preferred for
// newly-appended bullets; legacy aliases (`feature(s)`, `fix(es)`) map
// to the KaC canonical so old tooling/skills land entries under the
// right heading post-migration. Chamber extensions (Performance, etc.)
// retain their own headings and patch precedence.
const CANONICAL_HEADINGS = {
  // KaC canonical
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security',
  // Chamber extension
  breaking: 'Breaking',
  // Legacy → KaC canonical
  feature: 'Added',
  features: 'Added',
  fix: 'Fixed',
  fixes: 'Fixed',
  // Chamber extensions (area tags)
  perf: 'Performance',
  performance: 'Performance',
  refactor: 'Refactor',
  docs: 'Docs',
  documentation: 'Docs',
  tests: 'Tests',
  test: 'Tests',
  build: 'Build',
  ci: 'CI',
  chore: 'Chore',
  release: 'Release',
  packaging: 'Packaging',
};

function canonicalHeading(kind) {
  const key = String(kind || '').trim().toLowerCase();
  return CANONICAL_HEADINGS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Chore');
}

/**
 * Append a bullet under the appropriate `### Heading` of `## Unreleased`,
 * creating the section and the heading if either is missing.
 *
 * @param {string} changelogPath
 * @param {{ kind: string, summary: string, detail?: string, issue?: string }} entry
 * @returns {void}
 */
function appendEntry(changelogPath, { kind, summary, detail, issue }) {
  if (!kind) throw new Error('appendEntry: kind is required');
  if (!summary) throw new Error('appendEntry: summary is required');
  ensureUnreleasedSection(changelogPath);
  const text = fs.readFileSync(changelogPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const section = readUnreleasedSection(changelogPath);

  const headingWord = canonicalHeading(kind);
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
    // Insert a new ### Heading block at the end of ## Unreleased, ensuring a
    // blank line separates it from the next ## heading.
    let insertAt = section.endLine;
    while (insertAt > section.startLine + 1 && lines[insertAt - 1].trim() === '') {
      insertAt -= 1;
    }
    const block = ['', `### ${headingWord}`, '', bullet, ''];
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
  UNRELEASED_HEADING_RE,
  VERSION_HEADING_RE,
  HEADING_PRECEDENCE,
  CANONICAL_HEADINGS,
  readUnreleasedSection,
  recommendBump,
  recommendBumpFromChangelog,
  promoteUnreleasedToVersion,
  ensureUnreleasedSection,
  appendEntry,
};
