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

- **Insiders cut** = bump counter (`-insiders.N`) → build → upload to
  blob → push the tag only. Master is never modified.
- **Stable cut** = either release current master (`source_ref` empty)
  or promote an insider tag (`source_ref: vX.Y.Z-insiders.N`).
  Promotion rebuilds from the insider commit; it does not reuse the
  insider binary. macOS requires notarization warmup to be complete.

## Worked examples

**"Cut an insider build for testers"** →
Confirm channel is `insiders`. Predict next tag from
`git tag -l 'v*-insiders.*' --sort=-v:refname | head -1` and
`package.json` version. Dispatch
`gh workflow run release-insiders.yml --ref master`. After success,
hand back the install URL and the new tag.

**"Promote v0.62.4-insiders.3 to stable"** →
Confirm channel is `stable`, flow B. Verify `v0.62.4` doesn't already
exist (`git tag -l v0.62.4`). Verify macOS notary warmup is done.
Dispatch
`gh workflow run release.yml --ref master -f source_ref=v0.62.4-insiders.3`.
After success, surface the GitHub Release URL and call out that both
tags now point at the same commit.

**"Release master to stable"** →
Confirm channel is `stable`, flow A. Verify the version on
`origin/master` is what should ship and no tag conflict.
Dispatch `gh workflow run release.yml --ref master`. After success,
surface the GitHub Release URL.

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
git tag -l 'v*-insiders.*' --sort=-v:refname | head -5
node -p "require('./package.json').version"
```

Predict the next version:

- Latest insider tag base ≥ `package.json` version → increment the
  insider counter (`v0.62.4-insiders.3` → `v0.62.4-insiders.4`).
- Otherwise → reset counter on the new base (master is at `0.63.0`,
  latest insider is `v0.62.4-insiders.7` → next is `v0.63.0-insiders.0`).

Surface the prediction so the user confirms. The runner-side script
(`scripts/bump-insiders-version.js`) is the source of truth for the
actual computation; this prediction is for human confidence.

#### 3a.2 ASK - Optional base bump

By default the workflow increments the insider counter within the
current base. If the user wants to bake a base-version bump into this
insider build, ask:

```
Bump base version? patch | minor | major | none (default)
```

Pass `-f bump=<value>` to the dispatch if non-default.

#### 3a.3 AGENT - Dispatch

```bash
gh workflow run release-insiders.yml --ref master
# or with bump:
gh workflow run release-insiders.yml --ref master -f bump=minor
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
  A – release current master            (source_ref empty)
  B – promote an existing insider tag   (source_ref = vX.Y.Z-insiders.N)
```

#### 3b.2 AGENT - Pre-flight for the chosen flow

**Flow A (release master):**

```bash
git fetch origin master --quiet
git --no-pager log origin/master --oneline -n 5
node -p "require('./package.json').version"
gh api repos/ianphil/chamber/contents/package.json --jq '.content' \
  | base64 -d | jq -r .version
git tag -l 'v*' --sort=-v:refname | grep -v -- '-insiders\.' | head -5
```

Confirm the version on `origin/master`'s `package.json` is what should
ship and no `v<that-version>` tag already exists. If it does, the user
must bump master via `ship` first and come back.

**Flow B (promote insider):**

```bash
git fetch origin --tags --quiet
git tag -l 'v*-insiders.*' --sort=-v:refname | head -10
```

Ask which tag to promote, then confirm the derived stable version
doesn't already exist:

```bash
insider='v0.62.4-insiders.3'
stable=$(echo "$insider" | sed -E 's/-insiders\.[0-9]+$//')
git tag -l "$stable"
```

If the stable tag exists, stop. The user must bump master via `ship`,
cut a new insider off that bump, then promote that. Explain why.

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

**Flow A:**

```bash
gh workflow run release.yml --ref master
# patch-only bumps that need to release anyway:
gh workflow run release.yml --ref master -f force_release=true
```

**Flow B:**

```bash
gh workflow run release.yml --ref master -f source_ref=v0.62.4-insiders.3
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
- A reminder that `git checkout v<version>` will show the
  pre-promotion `package.json` content if Flow B (the version-strip
  mutation was not committed; the installer is the truthful artifact).

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
- **Insider tag doesn't exist** (Flow B) — stop, list recent tags.
- **Stable version tag already exists** (Flow A or B) — stop. Direct
  the user to bump master via `ship`, cut a new insider, then promote.
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
- **Don't push the version-bump commit to master.** That's why the
  insiders workflow pushes the tag only. Never run `git push origin
  HEAD` from a release workflow that just bumped the version.
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
