---
name: release
description: Dispatch a Chamber release build to either the insiders channel (Azure blob, Windows-only, invite-only testers) or the stable channel (public GitHub Releases, Windows + macOS). Use this skill whenever the user asks to release, cut, publish, promote, ship a build, push to insiders, send to testers, go public, or make a new version available — even if they don't explicitly name a channel. This skill picks the channel, runs pre-flight checks, handles stable remote feature-flag graduation when needed, dispatches the matching workflow via `gh`, and reports back. It may open mechanical release/policy PRs but never merges anything without explicit user approval.
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
| Stable   | Public      | `.github/workflows/release.yml`           | GitHub Releases                  | Windows + macOS arm64 (+x64 opt-in; macOS can be disabled by repo variable) |

Both are `workflow_dispatch` only — neither fires on push.

The core shape to keep in mind:

- **Insiders cut** = compute target stable from `## [Unreleased]` in
  `CHANGELOG.md` → bump counter (`vX.Y.Z-insiders.N`) → build → upload
  to blob → push the tag only. Master is never modified.
- **Stable cut** is almost always **promote an insider tag**
  (`source_ref: vX.Y.Z-insiders.N`). Direct-from-master dispatch is an
  emergency fallback that derives the version from `## [Unreleased]` the
  same way insiders does.
- **Stable feature flags** are controlled by the GitHub Pages policy at
  `docs/flags/v1/flags.json`. Stable releases must ask whether any
  preview flags are graduating to stable before dispatching the stable
  workflow.
- **Post-stable** (this skill's responsibility, run locally): open a PR
  that bumps `package.json` to the freshly shipped stable version and
  promotes `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD` in
  `CHANGELOG.md` (Keep a Changelog 1.1.0 format). This keeps master's
  invariant (version = last shipped stable).

## Worked examples

**"Cut an insider build for testers"** →
Confirm channel is `insiders`. Predict the next tag with
`node scripts/bump-insiders-version.js --dry-run` — this reads
`## [Unreleased]` in `CHANGELOG.md`, classifies the highest-precedence
heading, and prints the target stable + insider counter. Dispatch
`gh workflow run release-insiders.yml --ref master`. After success,
hand back the install URL and the new tag.

**"Promote v0.63.0-insiders.3 to stable"** →
Confirm channel is `stable`. Verify `v0.63.0` doesn't already exist
(`git tag -l v0.63.0`). Verify macOS notary warmup is done. Dispatch
`gh workflow run release.yml --ref master -f source_ref=v0.63.0-insiders.3`.
After success, open the post-release bump PR (Phase 3b.7) and surface
the GitHub Release URL.

**"Release straight from master (emergency)"** →
Confirm channel is `stable`, flow A. The workflow will compute the
target stable from `## [Unreleased]`. Confirm the computed version
doesn't already exist as a tag. Dispatch
`gh workflow run release.yml --ref master`. After success, open the
post-release bump PR.

## Workflow

Phases marked **ASK** must confirm in interactive mode; skip in
autopilot mode only when the caller already supplied the answers.

### 0. AGENT - Initialize the release checklist

Every release dispatch creates a per-run checklist that the skill
ticks off as it executes. The checklist is the mechanism that prevents
silent skips like the v0.63.0 post-release bump (Phase 3b.7 was never
run because the dispatching session ended before the build finished).

1. Load the template that matches the channel **once it's been
   chosen** (Phase 2 picks the channel; if running this phase before
   the channel is known, defer the load until after Phase 2 and just
   reserve the file path):
   - Insiders: `.github/skills/release/assets/insiders-checklist.md`
   - Stable: `.github/skills/release/assets/stable-checklist.md`
2. Substitute the placeholders the skill already has at dispatch time
   (`{{VERSION}}`, `{{BUILD_SHA}}`, `{{SOURCE_REF}}`, `{{FLOW}}`,
   `{{TARGET_STABLE}}`, `{{COUNTER}}`, `{{BUMP_SOURCE}}`,
   `{{BUMP_KIND}}`, `{{DATE}}`, `{{FLOW_DESCRIPTION}}`). Leave any
   placeholder unsubstituted (with the literal `{{…}}`) when the
   value isn't known yet — the skill fills it on the relevant phase.
3. Write the substituted checklist to the session-state files folder
   so it survives checkpoints. The path is:

   ```
   ~/.copilot/session-state/<session-id>/files/release-v<version>-<channel>-checklist.md
   ```

   (the session folder is given in the `session_context` block at the
   top of every conversation).
4. **Mirror every `- [ ]` item into the session todos table.** Use
   the kebab-case id in `[brackets]` as the todo `id` and the line
   text as the `title`. Initial status is `pending`. Add dependencies
   that match the phase order (`preflight-auth → channel-confirmed →
   compute-version → … → summary-written`).
5. As each phase completes, flip **both** the todo row
   (`UPDATE todos SET status='done' WHERE id=…`) **and** the
   matching `- [ ]` → `- [x]` in the checklist file on disk. The
   file is the durable record; the todos table is what blocks the
   session from ending with work outstanding.
6. **Refuse to end the session** with any `pending` or `in_progress`
   todos from the checklist. If a phase must be deferred (e.g. macOS
   notary warmup not done), mark the todo `blocked` with a reason in
   the description and append a note to the **Notes** section of the
   checklist file.

This checklist is **session-local**. It is intentionally not
committed: it captures dispatch-time decisions, links to run URLs,
and per-session context that would be noise in the repo. The skill
loads a fresh checklist on every dispatch.

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
`## [Unreleased]` in `CHANGELOG.md` for the highest-precedence conventional
heading, derives the target stable via SemVer, queries `git tag -l` for
existing `v<target>-insiders.*` tags, and prints the next insider version
plus the bump source heading.

Surface the predicted target stable, counter, and bump source to the
user so they can confirm intent (e.g. "next insider is
`v0.63.0-insiders.0`, derived from an `### Added` bullet in
Unreleased"). If `## [Unreleased]` is empty the script fails — direct the
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
  if (!bump) { console.error('Empty ## [Unreleased] — nothing to release.'); process.exit(1); }
  console.log('Master version (last shipped stable):', pkg.version);
  console.log('Bump source headings:', section.headings.join(', '));
  console.log('Target stable:', semver.inc(pkg.version, bump));
"
git tag -l 'v*' --sort=-v:refname | grep -v -- '-insiders\.' | head -5
```

Confirm `## [Unreleased]` has actionable entries and no `v<target>` tag
already exists. If the tag exists, stop and direct the user to cut an
insider first (so master gets updated via Flow B's post-release PR).

#### 3b.3 ASK/AGENT - Stable feature flag graduation

Stable builds read remote feature flags from GitHub Pages:

```text
https://chmbr.dev/flags/v1/flags.json
```

The source file is committed at `docs/flags/v1/flags.json` and is
published from `master` `/docs`. Before dispatching a stable release,
inspect the current policy and ask whether any flags should be enabled
for the stable channel:

```bash
git fetch origin master --quiet
git show origin/master:docs/flags/v1/flags.json
curl -fsSL https://chmbr.dev/flags/v1/flags.json
```

Prompt:

```
Any remote feature flags graduating to stable for this release?
  none [default]
  switchboardRelay
  byoLlm
  chamberCopilot
  multiple (list names)
```

Default is **none**. Do not infer stable flag graduation from insiders
values, changelog bullets, or the existence of a feature. A stable flag
flip is a product decision and must be explicit.

If the user chooses `none`, continue to macOS notary warmup.

If one or more flags should graduate:

1. Create a short-lived branch from `origin/master`.
2. Update only `channels.stable.<flag>` in `docs/flags/v1/flags.json`.
   Leave `channels.insiders` unchanged unless the user explicitly asks.
3. Run:

   ```bash
   npx vitest run --config config/vitest.config.ts packages/shared/src/feature-flags.test.ts apps/desktop/src/main/services/featureFlags/FeatureFlagService.test.ts
   npx markdownlint-cli2 ai-docs/feature-flags.md
   ```

4. Commit with the required trailer:

   ```bash
   git add docs/flags/v1/flags.json
   git commit -m "Update stable feature flags"
   ```

   Include:

   ```text
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```

5. Push and open a small PR titled `Update stable feature flags`.
6. Stop and ask the user to review/merge it. Do not merge it yourself.
7. After it lands, wait for GitHub Pages to publish and verify:

   ```bash
   curl -fsSL https://chmbr.dev/flags/v1/flags.json
   ```

8. Continue the stable release only after the published JSON reflects
   the intended stable flags.

This checkpoint prevents releasing a stable build while the remote
policy still keeps the graduating feature disabled for stable users.

#### 3b.4 ASK - macOS notary warmup

Apple's first-team notarization warmup takes 1–2 days per submission.
Until warmup is verified complete, stable dispatches may stall on the
macOS legs. Stable dispatches normally include macOS unless the GitHub
repository variable `STABLE_RELEASE_BUILD_MACOS` is set to exactly
`false`; that value skips both macOS legs and publishes Windows-only
stable artifacts. Ask:

```
macOS notarization warmup complete?
  yes — proceed
  no  — skip stable for now and cut/keep insiders only
  no, but release Windows-only stable — set STABLE_RELEASE_BUILD_MACOS=false first
```

If unsure, check recent submissions locally:

```bash
xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id 9LH8H98USP \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" | head -20
```

Recent submissions completing in <5 minutes means warmup is done. If
the user chooses Windows-only stable, set or verify the repo variable
before dispatch:

```bash
gh variable get STABLE_RELEASE_BUILD_MACOS || true
gh variable set STABLE_RELEASE_BUILD_MACOS --body false
gh variable get STABLE_RELEASE_BUILD_MACOS
```

Warn the user that this publish will not include `latest-mac.yml`, so
existing macOS installs stay on the previous stable until a later stable
release includes macOS artifacts again.

After macOS releases are ready again, restore the normal default:

```bash
gh variable delete STABLE_RELEASE_BUILD_MACOS
```

#### 3b.5 AGENT - Dispatch

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

#### 3b.6 AGENT - After success

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

> **Important — async coupling:** stable builds take 30–60 min (longer
> with macOS notarization warmup). Once the workflow dispatched at
> Phase 3b.5 finishes and `softprops/action-gh-release@v2` pushes the
> `vX.Y.Z` tag, `.github/workflows/post-release-bump.yml` fires
> automatically and opens the Phase 3b.7 bump PR for you. Do **not**
> end your work without confirming one of:
>
> 1. The `Post-release bump` workflow ran (`gh run list
>    --workflow=post-release-bump.yml --limit 1`) and the
>    `release/bump-v<version>` PR exists (`gh pr list --head
>    release/bump-v<version>`).
> 2. The user has been explicitly handed the link to that PR for
>    review.
>
> If the workflow hasn't fired yet — set a reminder via
> `manage_schedule` (or `gh run watch`) and check back. If it has
> fired but failed, fall through to Phase 3b.7 manually.

#### 3b.7 AGENT - Post-release bump PR (anchored to build SHA) — automated path + manual fallback

> **Default path is automatic.** `.github/workflows/post-release-bump.yml`
> opens this PR on stable tag push. Use the manual path below **only**
> when (a) the workflow failed, (b) the workflow was disabled, or (c)
> you're doing a release for which automation is intentionally not
> appropriate (rare). Verify automation status first:
>
> ```bash
> gh run list --workflow=post-release-bump.yml --limit 3
> gh pr list --head release/bump-v<version>
> ```

Master's `package.json` and `CHANGELOG.md` must now be advanced. This is
the **only** automation that mutates `package.json` on master under
Model B.

**Critical:** branch the bump PR from the **build SHA** (the insider tag
for Flow B, or `origin/master`'s SHA at dispatch time for Flow A) —
**not** from current `origin/master`. If anyone merged a `## Unreleased`
bullet during the build window (often 30–60 min for macOS
notarization), branching from current master would falsely attribute
those bullets to the just-released version and silently corrupt the
CHANGELOG. Anchoring to the build SHA captures `## Unreleased` exactly
as it was at build time; interim bullets land as a visible 3-way merge
conflict instead of silent corruption.

First, surface whether the conflict is coming. For Flow B
(`source_ref=vX.Y.Z-insiders.N`):

```bash
BUILD_SHA=$(git rev-list -n1 vX.Y.Z-insiders.N)
git fetch origin master --quiet
git --no-pager log --oneline "$BUILD_SHA..origin/master"
```

If the log is empty: clean fast-forward expected. If non-empty: a
CHANGELOG conflict is likely; surface the commit list to the user so
they know what to expect when reviewing.

Then open the bump PR:

```bash
git fetch origin --tags --quiet
git checkout -b release/bump-vX.Y.Z "$BUILD_SHA"

# Bump to the freshly shipped stable version
npm version <X.Y.Z> --no-git-tag-version --allow-same-version

# Promote ## [Unreleased] into ## [X.Y.Z] - YYYY-MM-DD (Keep a Changelog 1.1.0)
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
  --body "Post-release bump anchored to build SHA \`$BUILD_SHA\` (tag \`vX.Y.Z-insiders.N\`). Master now reflects the freshly shipped stable version. \`## [Unreleased]\` content at build time has been promoted to \`## [X.Y.Z] - YYYY-MM-DD\` in CHANGELOG.md (Keep a Changelog 1.1.0 format).

Build-SHA: $BUILD_SHA
Source-Ref: vX.Y.Z-insiders.N

If commits landed on master after the build SHA, the PR merge will surface a 3-way conflict in CHANGELOG.md — resolution is mechanical: keep the new \`## [X.Y.Z] - YYYY-MM-DD\` section AS-IS, and keep any \`## [Unreleased]\` bullets that landed during the build window under a fresh \`## [Unreleased]\` block above it. **Do not rebase or merge master into this branch** — that would defeat Pattern E anchoring and the \`model-b-gates\` PR check will fail. Resolve at PR-merge time only.

This PR is mechanical and CI-validated; merge after green checks."
```

**Conflict resolution on merge.** Common ancestor is the build SHA.
Master may have added bullets to `## [Unreleased]`; the bump branch
removed all `## [Unreleased]` content and inserted a new
`## [X.Y.Z] - YYYY-MM-DD` section. Git usually auto-merges
(non-overlapping edits). When it doesn't, resolve by keeping **both**
sections:

```
## [Unreleased]

### Fixed

- **Bullet that landed during the build window** - ...

## [X.Y.Z] - YYYY-MM-DD

### Added

- **Bullet that was in Unreleased at build SHA** - ...
```

No bullet is ever lost. The interim bullets stay in `## [Unreleased]`
for the next release to pick up.

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
   - Checklist:    ~/.copilot/session-state/<id>/files/release-vX.Y.Z-<channel>-checklist.md
```

This summary is the most valuable thing the skill produces. Releases
are infrequent enough that everyone — including the person who
dispatched — benefits from a written trail.

### 5. AGENT - Close the checklist

Before ending the session:

1. Confirm every checklist todo is `done` or `blocked` (with a
   documented reason in the checklist's **Notes** section). Any
   `pending` or `in_progress` row means the release isn't actually
   complete and the session must not end yet.
2. Append a final timestamped line to the checklist's **Notes**
   section: `Closed: <ISO datetime> · Session: <session-id>`.
3. Surface the checklist file path to the user as part of the summary
   above so they can review later or resume in a new session.

If the dispatching session has to end with a release still in flight
(e.g. waiting on a 30-min build), explicitly hand off:

- Tell the user which todos are still `pending` and what triggers
  each one (typically "the `Post-release bump` workflow firing").
- Suggest scheduling a check-in with `manage_schedule` so a future
  session re-loads the checklist (the file is the source of truth)
  and completes the outstanding items.

## Failure modes

- **Not on `master`** (local or `--ref`) — abort for insiders; warn
  for stable. Federated credential won't authenticate from any other ref.
- **Dirty working tree** — ask. Usually means uncommitted work that
  should land via `ship` first.
- **`gh auth status` fails** — stop, surface the message, ask to
  re-auth.
- **Empty `## [Unreleased]`** (insiders compute or Flow A) — stop. Direct
  the user to ship at least one change so the bump source exists.
- **Insider tag doesn't exist** (Flow B) — stop, list recent tags.
- **Stable version tag already exists** (Flow A or B) — stop. Direct
  the user to ship more changes (so the next target stable advances)
  and re-cut the insider, then promote.
- **Post-release bump PR has CHANGELOG conflict at merge** — expected
  when commits landed on master during the build window. Resolve by
  keeping both sections: the new `## [X.Y.Z] - YYYY-MM-DD` AS-IS, and
  any interim `## [Unreleased]` bullets under a fresh `## [Unreleased]`
  block above it. Never `--theirs` or `--ours` blindly — both sides
  carry real content. See Phase 3b.7 for the resolution template.
- **Stable feature flag policy PR needed** — stop before dispatching
  stable until the policy PR is merged and
  `https://chmbr.dev/flags/v1/flags.json` reflects the intended stable
  flags.
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
  (Phase 3b.7).
- **Don't reuse the insider binary as the stable artifact.** Promotion
  must rebuild — different channel string, different feed URL,
  different embedded `app-update.yml`, fresh signatures.
- **Don't modify `.working-memory/`.** It is agent-managed.

## Notes

- The ship skill is for PRs and never dispatches a release. This skill
  is for builds. It may open narrowly scoped release/policy PRs, but the
  user owns the merge.
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
