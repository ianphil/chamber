---
name: release
description: End-to-end release workflow for the Chamber repo. Use this when the user asks to release, cut, publish, or ship a build (as distinct from shipping a PR). It picks the channel (insiders or stable), runs the right pre-flight checks, dispatches the matching workflow via `gh`, and surfaces the run for monitoring. Does not modify code or merge anything.
---

# Release Skill

Dispatch a Chamber release. Two channels exist; pick the right one.

This skill is **not** the same as `ship`. Ship lands PRs. Release publishes
builds. Both are deliberate, manual actions.

Authoritative reference: [`ai-docs/release-channels.md`](../../../ai-docs/release-channels.md).
When in doubt, read it.

## When to invoke

User says any of:

- "release", "release insiders", "release stable", "cut a release"
- "ship a build" (not "ship a PR" — that's the `ship` skill)
- "publish", "publish stable", "publish to GitHub Releases"
- "promote", "promote insiders", "promote to stable"
- "make a build available to testers"

If ambiguous, ask once: insiders or stable?

## Channels at a glance

| Channel  | Audience    | Workflow                                  | Distribution                     | Platforms                  |
| -------- | ----------- | ----------------------------------------- | -------------------------------- | -------------------------- |
| Insiders | Invite-only | `.github/workflows/release-insiders.yml`  | Azure Blob `chamberinsiders`     | Windows only               |
| Stable   | Public      | `.github/workflows/release.yml`           | GitHub Releases                  | Windows + macOS arm64 (+x64 opt-in) |

Neither auto-fires on master push. Both are `workflow_dispatch` only.

## Mental anchor

- Insiders cut: bump counter (`-insiders.N`), build, upload to blob,
  tag-only push. Master is **never** modified.
- Stable cut: either release current master (`source_ref` empty) or
  promote an insider tag (`source_ref: v0.62.4-insiders.3`).
- Promotion **rebuilds** from the insider commit; it does not reuse the
  insider binary. macOS requires notarization warmup to be complete.

## Workflow

Phases marked **ASK** must confirm in interactive mode; autopilot only
applies when the caller has explicitly handed over the channel choice
and any required inputs.

### 1. AGENT - Pre-flight

```powershell
gh auth status
git fetch origin --quiet
git --no-pager status
git rev-parse --abbrev-ref HEAD
```

Required state:

- `gh auth status` succeeds.
- Working tree clean. Release dispatches operate on `origin/master`,
  not on your local working copy — but a dirty tree usually means
  something is half-done. If dirty, ask whether to abort, commit via
  `ship`, or stash.
- `origin/master` exists. The federated credential for the insiders
  blob is `refs/heads/master`-scoped; **insider releases must be
  dispatched against `master`**.

### 2. ASK - Pick the channel

If the user did not state it, ask:

```
Which channel?
  insiders  – Windows-only, invite-only, fast cadence, no notarization
  stable    – public, full platforms, requires macOS notary warmup
```

Reflect the choice back before continuing.

### 3a. Insiders dispatch

#### 3a.1 AGENT - Compute the next version

```powershell
git tag -l 'v*-insiders.*' --sort=-v:refname | Select-Object -First 5
node -p "require('./package.json').version"
```

Predict the next version:

- Latest insider tag base ≥ `package.json` version → increment the
  insider counter, e.g. `v0.62.4-insiders.3` → `v0.62.4-insiders.4`.
- Otherwise → reset counter on the new base, e.g. master is at
  `0.63.0`, latest insider is `v0.62.4-insiders.7` → next is
  `v0.63.0-insiders.0`.

Surface the prediction so the user confirms it matches their mental
model. The actual computation lives in
`scripts/bump-insiders-version.js`; the runner is the source of truth.

#### 3a.2 ASK - Optional bump

By default `bump-insiders-version.js` increments the insider counter
within the current base. If the user wants a stable-version bump
baked into the insider build (e.g. minor bump for a feature flag
flip), ask:

```
Bump base version? patch | minor | major | none (default)
```

Pass `bump=<value>` to the dispatch if non-default.

#### 3a.3 AGENT - Dispatch

```powershell
gh workflow run release-insiders.yml --ref master
# or with bump:
gh workflow run release-insiders.yml --ref master -f bump=minor
```

Confirm the dispatch landed:

```powershell
Start-Sleep -Seconds 3
gh run list --workflow=release-insiders.yml --limit 1
```

Print the run URL and tell the user how to monitor:

```powershell
gh run watch <run-id>
```

#### 3a.4 AGENT - After success

When the run completes:

```powershell
git fetch origin --tags --quiet
git tag -l 'v*-insiders.*' --sort=-v:refname | Select-Object -First 3
```

Surface the new tag and the install URL:

```
https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe
```

Note that the latest auto-update feed is at:

```
https://chamberinsiders.blob.core.windows.net/releases/insiders.yml
```

Existing testers update automatically; new testers need the install URL
out-of-band.

### 3b. Stable dispatch

#### 3b.1 ASK - Pick the source

Two flows. Ask explicitly:

```
Which stable flow?
  A – release current master            (source_ref empty)
  B – promote an existing insider tag   (source_ref = vX.Y.Z-insiders.N)
```

#### 3b.2 AGENT - Pre-flight for the chosen flow

**Flow A (release master):**

```powershell
git fetch origin master --quiet
git --no-pager log origin/master --oneline -n 5
node -p "require('./package.json').version"   # local
gh api repos/ianphil/chamber/contents/package.json --jq '.content' | base64 -d | jq -r .version
git tag -l 'v*' --sort=-v:refname | Where-Object { $_ -notlike '*-insiders.*' } | Select-Object -First 5
```

Confirm:

- The version on `origin/master`'s `package.json` is what should ship.
- No existing tag `v<that-version>` already points elsewhere. If yes,
  bump master via `ship` first, then come back.

**Flow B (promote insider):**

```powershell
git fetch origin --tags --quiet
git tag -l 'v*-insiders.*' --sort=-v:refname | Select-Object -First 10
```

Ask the user which tag to promote. Then confirm the derived stable
version:

```powershell
$insider = 'v0.62.4-insiders.3'
$stable  = $insider -replace '-insiders\.\d+$', ''
git tag -l $stable
```

If `$stable` already exists as a tag, stop. The user must bump master
to the next version (via `ship`), cut a new insider off that bump, then
promote. Explain that.

#### 3b.3 ASK - macOS notary warmup

Apple's first-team notarization warmup takes 1-2 days per submission.
Until warmup is verified complete, stable dispatches may stall on the
macOS legs. Ask:

```
macOS notarization warmup complete?
  yes — proceed
  no  — skip stable for now and cut/keep insiders only
```

If unsure, check recent stable releases or `notarytool history` locally:

```powershell
xcrun notarytool history --apple-id $env:APPLE_ID --team-id 9LH8H98USP --password $env:APPLE_APP_SPECIFIC_PASSWORD | Select-Object -First 20
```

Recent submissions completing in <5 minutes means warmup is done.

#### 3b.4 AGENT - Dispatch

**Flow A:**

```powershell
gh workflow run release.yml --ref master
# or, for patch-only bumps that need to release anyway:
gh workflow run release.yml --ref master -f force_release=true
```

**Flow B:**

```powershell
gh workflow run release.yml --ref master -f source_ref=v0.62.4-insiders.3
```

Confirm the run started:

```powershell
Start-Sleep -Seconds 3
gh run list --workflow=release.yml --limit 1
```

Print the run URL and the watch command.

#### 3b.5 AGENT - After success

```powershell
git fetch origin --tags --quiet
gh release view v<version>
```

Surface:

- The GitHub Releases URL.
- The two tags (insider + stable) if Flow B — both point at the same
  commit, by design.
- A reminder that `git checkout v<version>` will show the
  pre-promotion `package.json` content if Flow B (the version-strip
  mutation was not committed; the installer is the truthful artifact).

### 4. AGENT - Update the user's mental model

After dispatching, summarize what was just decided and what the artifact
audience is. Example:

```
✅ Dispatched insiders release
   - Channel:      insiders (Windows only)
   - Next tag:     v0.62.4-insiders.4
   - Audience:     invited testers only
   - Install URL:  https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe
   - Auto-update:  existing testers receive it automatically
   - Run:          <gh URL>
```

This is the most valuable thing the skill does. Releases are infrequent
enough that even the person dispatching benefits from a written summary.

## Failure modes

- **Not on `master`** (locally or `--ref` mismatch) — abort for insiders;
  warn for stable. The federated credential won't authenticate from any
  other ref.
- **Dirty working tree** — ask. Usually means there's uncommitted work
  that should be shipped via `ship` first.
- **`gh auth status` fails** — stop, surface the message, ask user to
  re-auth.
- **Insider tag doesn't exist** (Flow B) — stop. List recent tags.
- **Stable version tag already exists** (Flow A or B) — stop. Direct
  user to bump master via `ship`, then cut a new insider, then promote
  that.
- **Workflow dispatch returns non-zero** — capture the error, do not
  retry blindly. Surface so the user can decide.
- **macOS warmup uncertain** — default to *not* dispatching stable.
  Insiders are safer until verified.

## Never

- **Never dispatch from a feature branch.** Federated credential is
  master-scoped. The workflow will fail authenticating to Azure.
- **Never delete insider tags casually.** The commit they point at is
  off-branch; deleting the tag makes it unreachable and Git GC will
  eventually prune it (~30 days). Reproducibility and promotion are lost.
- **Never push the version-bump commit to master.** That's why insiders
  pushes the tag only. Do not run `git push origin HEAD` from a
  workflow that just bumped the version.
- **Never reuse the insider binary as the stable artifact.** Promotion
  rebuilds. Different channel, different feed URL, different embedded
  `app-update.yml`, fresh signatures.
- **Never modify `.working-memory/`.** It is agent-managed.

## Notes

- The ship skill is for PRs and never dispatches a release. The release
  skill is for builds and never modifies code.
- Insider auto-update reads `insiders.yml`. Stable reads `latest.yml` /
  `latest-mac.yml`. The embedded `app-update.yml` (set by
  `scripts/prepare-builder-prepackaged.js`) determines which one a given
  install polls.
- Repo variables (not secrets) for the insiders OIDC flow:
  `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `INSIDERS_STORAGE_ACCOUNT`, `INSIDERS_STORAGE_CONTAINER`. These are
  non-secret because OIDC has no shared secret to leak.
- Trusted Signing (Windows code-signing) uses `secrets.AZURE_*` for a
  different identity. The insiders workflow logs in twice: once with
  `secrets.*` for signing, then again with `vars.*` for blob upload.
- This skill opens nothing in GitHub Releases on its own — only the
  dispatched workflow does. The skill's job is to dispatch the right
  workflow with the right inputs and explain what's happening.
