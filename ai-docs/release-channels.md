# Release Channels

Chamber ships through two release channels. Both are **manual-only** —
nothing is published on push to `master`.

| Channel  | Audience               | Workflow                                | Distribution                                       | Platforms                |
| -------- | ---------------------- | --------------------------------------- | -------------------------------------------------- | ------------------------ |
| Stable   | Public                 | `.github/workflows/release.yml`         | GitHub Releases                                    | Windows + macOS arm64 (+ optional Intel) |
| Insiders | Invite-only            | `.github/workflows/release-insiders.yml`| Azure Blob `chamberinsiders/releases` (unlisted)   | Windows only             |

## Mental model

- `master`'s `package.json#version` always equals the **last shipped
  stable version**. It is stale between releases. The only automation
  that mutates it is the post-release bump PR opened by the `release`
  skill after a stable cut succeeds.
- The next stable version is **computed at release time** from the
  conventional `### Headings` accumulated in `## Unreleased` in
  `CHANGELOG.md`. `### Breaking` → major; `### Features` → minor;
  everything else → patch. Highest precedence wins.
- Insiders preview the **next stable**. `v0.63.0-insiders.0` is the
  first preview of the upcoming `v0.63.0`. The counter (`N`) advances
  with each preview against that target. If a new ship adds a
  higher-precedence heading to `## Unreleased`, the target stable
  advances (e.g. `0.62.5` → `0.63.0`) and the counter resets to `0`.
- Stable releases create `vX.Y.Z` tags; insiders create
  `vX.Y.Z-insiders.N` tags. **Under Model B the insider tag points at
  master's SHA directly** — no off-branch version-bump commit exists.
- The same source SHA can be cut as an insider build, hardened, and then
  promoted to stable. Promotion rebuilds — it does not re-publish the
  insider binary.

## Git shape

### After an insider cut
The CI runner computes the next insider version from `## Unreleased`,
mutates `package.json` in the runner's working tree (used only by the
build), and tags master's commit. No commit is created; the tag points
at master:

```
master:   A──B──C──D    ← tag: v0.63.0-insiders.3
```

`git tag -l 'v*-insiders.*'` lists every insider build. They all point
at master commits. No `insiders/*` branch exists or is needed.

> **Surprise to expect:** `git checkout v0.63.0-insiders.3` shows the
> stale master `package.json` (e.g. `"version": "0.62.4"`). That's by
> design. The insider version was computed at dispatch time and only
> embedded in the **built installer**, never committed. The installer
> is the truthful artifact for the released version string.

### After promoting an insider to stable
`release.yml` with `source_ref: v0.63.0-insiders.3` checks out master
at that SHA, derives the stable version from the **tag name**
(`v0.63.0-insiders.3` → `0.63.0`), applies it via `npm version
--allow-same-version` in the runner workspace **only — no commit is
made**, builds + signs + notarizes, and creates the stable tag at the
same commit:

```
master:   A──B──C──D    ← tag: v0.63.0-insiders.3
                        ← tag: v0.63.0   (added by promotion)
```

Two tags, same commit. The insider tag is the audit record ("this is
what testers ran"); the stable tag is what GitHub Releases publishes
against. The two installers are different binaries (different embedded
version string, different `app-update.yml` channel + feed URL, fresh
signatures) but they came from the same source tree.

After the workflow succeeds, the `release` skill opens a **post-release
bump PR** that:

- runs `npm version 0.63.0 --no-git-tag-version --allow-same-version`
  on master,
- calls `promoteUnreleasedToVersion` on `CHANGELOG.md` to turn the
  `## Unreleased` block into `## v0.63.0 (YYYY-MM-DD)`,
- opens the PR for review.

Once merged, master satisfies the invariant again: `package.json#version
= 0.63.0 = last shipped stable`.

### Emergency release from master (no insider step)
`release.yml` with `source_ref` empty computes the next stable from
`## Unreleased` the same way the insiders compute does, applies it on
the runner, and tags master. The post-release bump PR is still required
afterward.

### Tag hygiene
- **Do not delete insider tags casually.** Under Model B insider tags
  point at master commits, so deleting an insider tag does not orphan a
  commit — but you do lose the audit record of "this is what testers
  ran" and the reproducibility handle. Keep insider tags until at least
  the stable they previewed has shipped.
- Tags are cheap (a ref). A few hundred is fine. Prune only if/when the
  list actually becomes a nuisance, and only prune insider tags whose
  stable counterpart has already shipped.
- No release branches exist or need to.

### Version conflicts
If `vX.Y.Z` already exists when you try to promote, the workflow will
fail. Correct behavior — you can't double-publish. Add more changelog
entries via `ship` so the next target stable advances, cut a new
insider, then promote.

## Insiders channel

### What it is
- Windows-only signed NSIS installer, published to a private Azure Blob.
- Auto-update reads `insiders.yml` from the same blob.
- macOS is intentionally excluded until the Apple Developer ID
  notarization warmup completes. Insider testers run Windows only.

### Where artifacts live
- Storage account: `chamberinsiders` (resource group `chamber-signing`,
  region `eastus`).
- Container: `releases`, access level `Blob` (anonymous reads of known
  blob names, anonymous listing blocked).
- Stable install URL (overwritten on each cut):
  `https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe`
- Auto-update feed: `https://chamberinsiders.blob.core.windows.net/releases/insiders.yml`

### Authentication
- GitHub Actions authenticates to Azure with OIDC federated identity —
  no client secret.
- AAD app: `chamber-gh-actions-insiders`. Federated credential trusts
  `repo:ianphil/chamber:ref:refs/heads/master` only. Feature branches
  cannot upload.
- Role assignment is `Storage Blob Data Contributor` scoped to the
  container, not the storage account.
- Shared-key auth on the storage account is **disabled**. All writes go
  through AAD; reads are anonymous via `--public-access blob`.
- Non-secret IDs (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `INSIDERS_STORAGE_ACCOUNT`,
  `INSIDERS_STORAGE_CONTAINER`) are stored as repo **variables**, not
  secrets.

### How to cut an insider build
1. Make sure `## Unreleased` in `CHANGELOG.md` has the bullets you want
   the next stable to contain. Each `ship` invocation appends one.
2. Go to **Actions → Release Insiders → Run workflow** on the default
   branch.
3. Optional `override_bump` input — `patch`, `minor`, `major`, or `none`
   (default = derive from `## Unreleased`). Only use for emergencies
   where the changelog doesn't reflect the intended bump.
4. The workflow will:
   - Run `scripts/bump-insiders-version.js`, which reads master's
     `package.json#version` and the highest-precedence `### Heading`
     in `## Unreleased`, computes the target stable via SemVer, and
     advances/resets the `-insiders.N` counter against existing tags.
   - Run `npm install` to refresh the lockfile in the runner workspace.
   - Sign via the existing Trusted Signing identity.
   - Build with `CHAMBER_RELEASE_CHANNEL=insiders` and
     `CHAMBER_BUILDER_UPDATE_URL` pointing at the blob. The embedded
     `app-update.yml` ships `channel: insiders` so the installed app
     reads `insiders.yml` on update checks.
   - Validate the manifest with
     `node scripts/validate-builder-release.js --channel=insiders`.
   - Upload artifacts to the blob via `az storage blob upload-batch
     --auth-mode login`.
   - Tag master's commit `vX.Y.Z-insiders.N` and push the **tag only**.
     No commit is created — the `package.json` mutation lives only in
     the runner's working tree and the built installer.

### What testers do
- First install: download
  `Chamber-Setup-latest-insiders.exe` from the URL above and run it.
  Share this URL out-of-band — it is not linked from the website or
  README.
- Subsequent updates: nothing. The installed app polls `insiders.yml`
  and self-updates.
- Revert to stable: uninstall, then install the latest GitHub Release.
  Mind data lives in the user profile and is preserved across reinstall.

See [`../INSIDERS.md`](../INSIDERS.md) for the user-facing version of
this.

## Stable channel

### What it is
- Public release. Windows NSIS installer + macOS DMG/ZIP (arm64;
  optionally Intel).
- Auto-update reads `latest.yml` / `latest-mac.yml` from the GitHub
  Release.
- macOS builds are signed with the Developer ID identity and notarized.

### How to cut a stable release
Two flows, same workflow. **Flow B (promote insider) is the default.**

**Flow B — promote an insider build (recommended):**
1. Go to **Actions → Release → Run workflow** on `master`.
2. Set `source_ref` to the insider tag, e.g. `v0.63.0-insiders.7`.
3. The workflow will:
   - Check out master at that SHA.
   - Detect the `vX.Y.Z-insiders.N` tag-name pattern in `source_ref`
     and derive the stable version from the **tag name** (not from
     `package.json`, which under Model B holds the last shipped stable).
   - Apply that version via `npm version --no-git-tag-version
     --allow-same-version`, then `npm install`.
   - Build Windows + macOS, sign, notarize macOS.
   - Publish to GitHub Releases tagged `vX.Y.Z`. Release notes include
     `Promoted from insiders build vX.Y.Z-insiders.N`.
4. After the workflow succeeds, the `release` skill opens a
   **post-release bump PR** that advances master's `package.json` to
   `X.Y.Z` and promotes `## Unreleased` into `## vX.Y.Z (date)` in
   `CHANGELOG.md`.

**Flow A — emergency release from master:**
1. Make sure `## Unreleased` in `CHANGELOG.md` is non-empty.
2. Go to **Actions → Release → Run workflow** on `master`.
3. Leave `source_ref` empty. The workflow computes the next stable
   version from `## Unreleased` using the same precedence rules as
   insiders (`### Breaking` → major; `### Features` → minor; else
   patch), applies it on the runner, builds, and tags master.
4. The post-release bump PR is still required afterward.

The `force_release` input (defaults to `true`) skips the patch-only
auto-skip guard — keep it `true` for manual dispatches.

### macOS notarization warmup
- The first ~5–10 submissions from a new Apple Developer ID team go
  through Apple's "in-depth analysis" (per Apple DTS), which can take
  1–2 days each. Subsequent builds clear in <5 minutes.
- Until warmup is done, the macOS leg of the stable workflow may time
  out at the client-side `--wait --timeout 30m`. Apple has no published
  ceiling and `notarytool` has no cancel API. Stuck submissions still
  count toward warmup.

## How channels are wired through the build

`config/electron-builder.config.cjs::resolvePublishTargets()`:
- No env vars → GitHub provider (stable default).
- `CHAMBER_BUILDER_UPDATE_URL` set → generic provider with that URL.
- `CHAMBER_RELEASE_CHANNEL` set → adds `channel: <name>` to the publish
  entry (controls which `<channel>.yml` electron-builder writes).

`scripts/prepare-builder-prepackaged.js::appendChannel()`:
- Mirrors the channel into the **embedded** `app-update.yml` shipped
  inside the installer. This is what the installed app reads to decide
  which manifest to poll.
- Both sides must agree. The insiders workflow sets both to `insiders`;
  stable sets neither.

`scripts/validate-builder-release.js`:
- `--channel=<name>` (defaults to `latest`) selects which manifest file
  to validate against. The insiders workflow passes `--channel=insiders`.

`scripts/changelog.js`:
- Single source of truth for parsing/writing `CHANGELOG.md`.
  `readUnreleasedSection` returns the headings + raw text under
  `## Unreleased`. `recommendBumpFromChangelog` maps the highest-
  precedence heading to `patch`/`minor`/`major`/null. `appendEntry`
  writes a new bullet under the correct `### Heading` (used by ship).
  `promoteUnreleasedToVersion` turns `## Unreleased` into a real
  `## vX.Y.Z (date)` section (used by the post-release bump PR).

`scripts/bump-insiders-version.js`:
- `readMasterVersion()` reads `package.json` and refuses to run if it
  contains a prerelease suffix (would mean master's Model B invariant
  was already violated).
- Computes target stable via `semver.inc(masterVersion,
  recommendBumpFromChangelog())`.
- `listInsiderCountersForBase(target)` queries
  `git tag --list v<target>-insiders.*` and returns the next counter
  (max + 1, or 0 if none exist).
- `stableTagExists(target)` blocks dispatch if the target stable
  already shipped — forces sequencing through the post-release bump PR.

## Decision log

- **Why Model B (release-time version bumps)?** Surveyed VS Code,
  Electron, Node.js, Chrome, Firefox, GitHub CLI, `semantic-release`,
  and `release-please`. The dominant pattern is: derive the version
  from accumulated commit/changelog signal at release time, not at PR
  time. Benefits: consecutive stable history without gaps; `-insiders.N`
  counter has real meaning (iterations against a single target); CHANGELOG
  authorship happens close to the change while version computation
  happens close to the cut. Trade-off: master's `package.json` is stale
  between releases — accepted because the released artifacts (installer,
  GitHub Release tag) carry the truthful version.
- **Why conventional headings to drive the bump?** Mechanical and
  auditable. The release skill never has to infer intent; it reads the
  headings and applies the precedence table. Typos default to `patch`
  so a misspelled heading never blocks a release.
- **Why not GitHub Releases prereleases for insiders?** They're still
  indexed and discoverable. "Unlisted" needed an out-of-band URL — Azure
  blob with anonymous reads but no listing fits.
- **Why rebuild on promotion instead of re-uploading the insider EXE?**
  Insiders and stable have different `app-update.yml` contents
  (different channel, different feed URL). Signing identity could
  diverge later. Rebuilding from the same SHA keeps each artifact
  truthful about its channel.
- **Why no auto-deploy?** The cost of "I forgot to dispatch" is small.
  The cost of "every PR merge ships to testers" is update fatigue and
  the risk of a bad auto-update with no human in the loop. Manual
  dispatch keeps the human in the loop without slowing things down.
- **Why tag-only pushes (no synthetic bump commit)?** Under Model B the
  insider's version is derived data; embedding it in a committed
  `package.json` mutation would add noise to history with no benefit.
  The tag points at master's commit; the version lives in the built
  artifact.
- **Why federated identity instead of a managed identity?** GH-hosted
  runners are outside Azure and cannot host an MI. OIDC federation is
  the equivalent — no long-lived secret to rotate.

## Related docs
- [`../INSIDERS.md`](../INSIDERS.md) — user-facing install instructions
  for testers (intentionally unlinked from the README).
- [`apple-notary-queue.md`](./apple-notary-queue.md) — runbook for
  checking Apple's notarization queue, warmup status, and rejection logs.
- [`local-auto-update-test.md`](./local-auto-update-test.md) — local
  loopback test for the auto-update flow.
- [`edge-marketplace-install-link-smoke.md`](./edge-marketplace-install-link-smoke.md)
  — Edge install-link smoke test.
