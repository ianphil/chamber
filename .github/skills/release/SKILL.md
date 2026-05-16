---
name: release
description: Dispatch a Chamber release build to either the insiders channel (Azure blob, Windows-only, invite-only testers) or the stable channel (public GitHub Releases, Windows + macOS). Use this skill whenever the user asks to release, cut, publish, promote, ship a build, push to insiders, send to testers, go public, or make a new version available — even if they don't explicitly name a channel. This skill picks the channel, runs pre-flight checks, dispatches the matching workflow via `gh`, and reports back. It does not modify source code, does not open PRs, and does not merge anything (use the `ship` skill for those).
---

# Release Skill

Dispatch a Chamber release. Two channels, picked deliberately, dispatched
manually. Authoritative mechanics live in
[`ai-docs/release-channels.md`](../../../ai-docs/release-channels.md);
this skill is the operational runbook on top of them.

This skill is **not** the same as `ship`. Ship lands PRs. Release
publishes builds. Neither calls the other.

## When to invoke

Trigger on any of these (or close variants):

- "release", "release insiders", "release stable", "cut a release"
- "ship a build" (when distinct from "ship a PR" — ask if unclear)
- "publish", "publish stable", "publish to GitHub Releases"
- "promote", "promote insiders", "promote to stable"
- "make a build available to testers", "send to testers", "push to insiders"
- "go public with this", "make this the public version"

If the user's intent is ambiguous between PR shipping and build shipping,
ask once. If the channel is ambiguous, ask once.

## Channels

| Channel  | Audience    | Workflow                                  | Distribution                     | Platforms                           |
| -------- | ----------- | ----------------------------------------- | -------------------------------- | ----------------------------------- |
| Insiders | Invite-only | `.github/workflows/release-insiders.yml`  | Azure Blob `chamberinsiders`     | Windows only                        |
| Stable   | Public      | `.github/workflows/release.yml`           | GitHub Releases                  | Windows + macOS arm64 (+x64 opt-in) |

Both are `workflow_dispatch` only — neither fires on push.

The core shape to keep in mind:

- **Insiders cut** = compute target stable from `## Unreleased` in
  `CHANGELOG.md` → bump counter (`vX.Y.Z-insiders.N`) → build → upload
  to blob → push the tag only. Master is never modified.
- **Stable cut** is almost always **promote an insider tag**
  (`source_ref: vX.Y.Z-insiders.N`). Direct-from-master dispatch is an
  emergency fallback that derives the version from `## Unreleased` the
  same way insiders does.
- **Post-stable** (this skill's responsibility, run locally): open a PR
  that bumps `package.json` to the freshly shipped stable version and
  promotes `## Unreleased` into `## vX.Y.Z (date)` in `CHANGELOG.md`.
  This keeps master's invariant (version = last shipped stable).

## Worked examples

**"Cut an insider build for testers"** →
Confirm channel is `insiders`. Predict the next tag with
`node scripts/bump-insiders-version.js --dry-run` — this reads
`## Unreleased` in `CHANGELOG.md`, classifies the highest-precedence
heading, and prints the target stable + insider counter. Dispatch
`gh workflow run release-insiders.yml --ref master`. After success,
hand back the install URL and the new tag.

**"Promote v0.63.0-insiders.3 to stable"** →
Confirm channel is `stable`. Verify `v0.63.0` doesn't already exist
(`git tag -l v0.63.0`). Verify macOS notary warmup is done. Dispatch
`gh workflow run release.yml --ref master -f source_ref=v0.63.0-insiders.3`.
After success, open the post-release bump PR (Phase 3b.6) and surface
the GitHub Release URL.

**"Release straight from master (emergency)"** →
Confirm channel is `stable`, flow A. The workflow will compute the
target stable from `## Unreleased`. Confirm the computed version
doesn't already exist as a tag. Dispatch
`gh workflow run release.yml --ref master`. After success, open the
post-release bump PR.

## Workflow

Phases marked **ASK** must confirm in interactive mode; skip in
autopilot mode only when the caller already supplied the answers.

### 1. AGENT - Pre-flight

```bash
gh auth status
git fetch origin --quiet
git --no-pager status
git rev-parse --abbrev-ref HEAD
```

Required state:

- `gh auth status` succeeds.
- Working tree clean. Release dispatches run against `origin/master`,
  so local dirt doesn't directly affect the build — but it usually
  signals something half-done. If dirty, ask whether to abort, commit
  via `ship`, or stash.
- `origin/master` exists. The federated credential for the insiders
  blob is `refs/heads/master`-scoped; **insider releases must dispatch
  against `master`**.

### 2. ASK - Pick the channel

```
Which channel?
  insiders  – Windows-only, invite-only, fast cadence, no notarization
  stable    – public, full platforms, requires macOS notary warmup
```

Reflect the choice back before continuing.

### 3a. Insiders dispatch

#### 3a.1 AGENT - Compute the next version

```bash
node scripts/bump-insiders-version.js --dry-run
```

The script reads `package.json` (last shipped stable), parses
`## Unreleased` in `CHANGELOG.md` for the highest-precedence conventional
heading, derives the target stable via SemVer, queries `git tag -l` for
existing `v<target>-insiders.*` tags, and prints the next insider version
plus the bump source heading.

Surface the predicted target stable, counter, and bump source to the
user so they can confirm intent (e.g. "next insider is
`v0.63.0-insiders.0`, derived from a `### Features` bullet in
Unreleased"). If `## Unreleased` is empty the script fails — direct the
user to ship a change first, or to use the override below for a
genuinely test-only build.

#### 3a.2 ASK - Optional bump override

By default the workflow honors the bump derived from `## Unreleased`.
Override is only for emergency cases (e.g., re-cut for infrastructure
reasons without any user-facing changelog entries). Ask only if the user
mentioned it:

```
Override bump? patch | minor | major | none (default)
```

Pass `-f override_bump=<value>` to the dispatch if non-default.

#### 3a.3 AGENT - Dispatch

```bash
gh workflow run release-insiders.yml --ref master
# or with override:
gh workflow run release-insiders.yml --ref master -f override_bump=minor
```

Confirm the dispatch landed:

```bash
sleep 3
gh run list --workflow=release-insiders.yml --limit 1
```

Print the run URL and tell the user how to monitor:

```bash
gh run watch <run-id>
```

#### 3a.4 AGENT - After success

```bash
git fetch origin --tags --quiet
git tag -l 'v*-insiders.*' --sort=-v:refname | head -3
```

Surface the new tag, the install URL
(`https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe`),
and the auto-update feed
(`https://chamberinsiders.blob.core.windows.net/releases/insiders.yml`).
Existing testers auto-update; new testers need the install URL
out-of-band.

### 3b. Stable dispatch

#### 3b.1 ASK - Pick the source

```
Which stable flow?
  B – promote an existing insider tag   (source_ref = vX.Y.Z-insiders.N)   [default]
  A – emergency release from master     (source_ref empty; computes from ## Unreleased)
```

Default is **B**. Flow A skips insider piloting and should be an
explicit choice (hotfix where insider piloting isn't possible, or first
release after the migration).

#### 3b.2 AGENT - Pre-flight for the chosen flow

**Flow B (promote insider) — default:**

```bash
git fetch origin --tags --quiet
git tag -l 'v*-insiders.*' --sort=-v:refname | head -10
```

Ask which tag to promote, then confirm the derived stable version
doesn't already exist:

```bash
insider='v0.63.0-insiders.3'
stable=$(echo "$insider" | sed -E 's/-insiders\.[0-9]+$//')
git tag -l "$stable"
```

If the stable tag exists, stop. The user must ship more changes to bump
the target, cut a new insider, then promote that. Explain why.

**Flow A (emergency release from master):**

```bash
git fetch origin master --quiet
git --no-pager log origin/master --oneline -n 5
node -e "
  const ch = require('./scripts/changelog');
  const pkg = require('./package.json');
  const semver = require('semver');
  const { bump, section } = ch.recommendBumpFromChangelog('./CHANGELOG.md');
  if (!bump) { console.error('Empty ## Unreleased — nothing to release.'); process.exit(1); }
  console.log('Master version (last shipped stable):', pkg.version);
  console.log('Bump source headings:', section.headings.join(', '));
  console.log('Target stable:', semver.inc(pkg.version, bump));
"
git tag -l 'v*' --sort=-v:refname | grep -v -- '-insiders\.' | head -5
```

Confirm `## Unreleased` has actionable entries and no `v<target>` tag
already exists. If the tag exists, stop and direct the user to cut an
insider first (so master gets updated via Flow B's post-release PR).

#### 3b.3 ASK - macOS notary warmup

Apple's first-team notarization warmup takes 1–2 days per submission.
Until warmup is verified complete, stable dispatches may stall on the
macOS legs. Ask:

```
macOS notarization warmup complete?
  yes — proceed
  no  — skip stable for now and cut/keep insiders only
```

If unsure, check recent submissions locally:

```bash
xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id 9LH8H98USP \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" | head -20
```

Recent submissions completing in <5 minutes means warmup is done.

#### 3b.4 AGENT - Dispatch

**Flow B (default):**

```bash
gh workflow run release.yml --ref master -f source_ref=v0.63.0-insiders.3
```

**Flow A (emergency):**

```bash
gh workflow run release.yml --ref master
# patch-only bumps that need to release anyway:
gh workflow run release.yml --ref master -f force_release=true
```

Confirm the run started:

```bash
sleep 3
gh run list --workflow=release.yml --limit 1
```

Print the run URL and the watch command.

#### 3b.5 AGENT - After success

```bash
git fetch origin --tags --quiet
gh release view v<version>
```

Surface:

- The GitHub Releases URL.
- The two tags (insider + stable) if Flow B — both point at the same
  commit, by design.
- A reminder that `git checkout v<version>` will show master's stale
  `package.json` (one stable behind). Under Model B, the released
  version was computed at dispatch time and only embedded in the built
  artifact, not committed. The post-release bump PR (next phase) fixes
  this.

#### 3b.6 AGENT - Post-release bump PR

Master's `package.json` and `CHANGELOG.md` must now be advanced. This is
the **only** automation that mutates `package.json` on master under
Model B. Run locally:

```bash
git checkout master
git pull --ff-only origin master
git checkout -b release/bump-vX.Y.Z

# Bump master to the freshly shipped stable version
npm version <X.Y.Z> --no-git-tag-version --allow-same-version

# Promote ## Unreleased into ## vX.Y.Z (YYYY-MM-DD)
node -e "
  const ch = require('./scripts/changelog');
  const today = new Date().toISOString().slice(0, 10);
  ch.promoteUnreleasedToVersion('./CHANGELOG.md', '<X.Y.Z>', today);
"

git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): bump master to vX.Y.Z post-release

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin HEAD

gh pr create --base master --head release/bump-vX.Y.Z \
  --title "chore(release): bump master to vX.Y.Z post-release" \
  --body "Post-release bump. Master now reflects the freshly shipped stable version. \`## Unreleased\` has been promoted to \`## vX.Y.Z\` in CHANGELOG.md.

This PR is mechanical and CI-validated; merge after green checks."
```

The user reviews and merges the PR. Do not auto-merge — the user owns
the master-mutation moment.

### 4. AGENT - Summarize what was decided

After dispatching, summarize so both the human and any future agent can
see exactly what happened. Example:

```
✅ Dispatched insiders release
   - Channel:      insiders (Windows only)
   - Next tag:     v0.62.4-insiders.4
   - Audience:     invited testers only
   - Install URL:  https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe
   - Auto-update:  existing testers receive it automatically
   - Run:          <gh URL>
```

This summary is the most valuable thing the skill produces. Releases
are infrequent enough that everyone — including the person who
dispatched — benefits from a written trail.

## Failure modes

- **Not on `master`** (local or `--ref`) — abort for insiders; warn
  for stable. Federated credential won't authenticate from any other ref.
- **Dirty working tree** — ask. Usually means uncommitted work that
  should land via `ship` first.
- **`gh auth status` fails** — stop, surface the message, ask to
  re-auth.
- **Empty `## Unreleased`** (insiders compute or Flow A) — stop. Direct
  the user to ship at least one change so the bump source exists.
- **Insider tag doesn't exist** (Flow B) — stop, list recent tags.
- **Stable version tag already exists** (Flow A or B) — stop. Direct
  the user to ship more changes (so the next target stable advances)
  and re-cut the insider, then promote.
- **Post-release bump PR conflicts with concurrent ship** — rebase the
  bump branch on master; resolve `CHANGELOG.md` by keeping
  `promoteUnreleasedToVersion`'s output and re-inserting any newer
  `## Unreleased` bullets at the top.
- **Workflow dispatch returns non-zero** — capture and surface the
  error. Don't retry blindly.
- **macOS warmup uncertain** — default to *not* dispatching stable.
  Insiders are safer until verified.

## Guardrails

These are easy to do by accident and hard to undo:

- **Don't dispatch from a feature branch.** Federated credential is
  master-scoped; the workflow will fail authenticating to Azure.
- **Don't delete insider tags casually.** The commit they point at is
  off-branch; deleting the tag makes it unreachable and Git GC will
  prune it (~30 days). Reproducibility and promotion are lost.
- **Don't push the version-bump commit to master from the workflow.**
  The insiders workflow tags master's SHA directly under Model B — no
  bump commit is generated. The release workflow mutates `package.json`
  only on the runner. The only legitimate path that mutates master's
  version field is the post-release bump PR opened by this skill
  (Phase 3b.6).
- **Don't reuse the insider binary as the stable artifact.** Promotion
  must rebuild — different channel string, different feed URL,
  different embedded `app-update.yml`, fresh signatures.
- **Don't modify `.working-memory/`.** It is agent-managed.

## Notes

- The ship skill is for PRs and never dispatches a release. This skill
  is for builds and never modifies code.
- Insider auto-update reads `insiders.yml`. Stable reads `latest.yml` /
  `latest-mac.yml`. The embedded `app-update.yml` (written by
  `scripts/prepare-builder-prepackaged.js`) determines which one a
  given install polls.
- Repo variables (not secrets) for the insiders OIDC flow:
  `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `INSIDERS_STORAGE_ACCOUNT`, `INSIDERS_STORAGE_CONTAINER`. They're
  non-secret because OIDC has no shared secret to leak.
- Trusted Signing (Windows code-signing) uses `secrets.AZURE_*` for a
  different identity. The insiders workflow logs in twice: once with
  `secrets.*` for signing, then again with `vars.*` for blob upload.
- This skill opens nothing in GitHub Releases on its own — only the
  dispatched workflow does. The skill's job is to dispatch the right
  workflow with the right inputs and explain what's happening.
