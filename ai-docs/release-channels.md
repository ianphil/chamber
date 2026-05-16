# Release Channels

Chamber ships through two release channels. Both are **manual-only** —
nothing is published on push to `master`.

| Channel  | Audience               | Workflow                                | Distribution                                       | Platforms                |
| -------- | ---------------------- | --------------------------------------- | -------------------------------------------------- | ------------------------ |
| Stable   | Public                 | `.github/workflows/release.yml`         | GitHub Releases                                    | Windows + macOS arm64 (+ optional Intel) |
| Insiders | Invite-only            | `.github/workflows/release-insiders.yml`| Azure Blob `chamberinsiders/releases` (unlisted)   | Windows only             |

## Mental model

- `master` carries the development version. Releases come from off-master
  tag snapshots, not from master itself.
- Stable releases create `vX.Y.Z` tags; insiders create
  `vX.Y.Z-insiders.N` tags. The commit each tag points to is **not pushed
  to master** — the tag is the only handle.
- The same source SHA can be cut as an insider build, hardened, and then
  promoted to stable. Promotion rebuilds — it does not re-publish the
  insider binary.
- `package.json` on master does not need to track every release. The
  source of truth for "what version exists" is the git tags.

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
1. Go to **Actions → Release Insiders → Run workflow** on the default
   branch.
2. Optional `bump` input — `patch` (default behavior), `minor`, or
   `major`. Otherwise the patch counter increments.
3. The workflow will:
   - Run `scripts/bump-insiders-version.js`, which reads the latest
     `v*-insiders.*` tag and `package.json` (whichever is newer) and
     computes the next version.
   - Run `npm install` to refresh the lockfile (full install, not
     `--package-lock-only`).
   - Sign via the existing Trusted Signing identity.
   - Build with `CHAMBER_RELEASE_CHANNEL=insiders` and
     `CHAMBER_BUILDER_UPDATE_URL` pointing at the blob. The embedded
     `app-update.yml` ships `channel: insiders` so the installed app
     reads `insiders.yml` on update checks.
   - Validate the manifest with
     `node scripts/validate-builder-release.js --channel=insiders`.
   - Upload artifacts to the blob via `az storage blob upload-batch
     --auth-mode login`.
   - Tag the bump commit `vX.Y.Z-insiders.N` and push the **tag only**.
     The commit is not pushed to master.

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
Two flows, same workflow.

**Flow A — release current `master`:**
1. Bump the version in `package.json` on master and merge it.
2. Go to **Actions → Release → Run workflow** on `master`.
3. Leave `source_ref` empty. The workflow runs against the triggering
   commit.

**Flow B — promote an insider build:**
1. Go to **Actions → Release → Run workflow** on `master`.
2. Set `source_ref` to the insider tag, e.g. `v0.62.4-insiders.7` (or a
   raw commit SHA).
3. The workflow will:
   - Check out that ref.
   - Detect the `-insiders.N` suffix on `package.json#version` and strip
     it for the stable version (`0.62.4-insiders.7` → `0.62.4`).
   - Apply that version via `npm version --no-git-tag-version
     --allow-same-version`, then `npm install`.
   - Build Windows + macOS, sign, notarize macOS.
   - Publish to GitHub Releases tagged `vX.Y.Z`. Release notes include
     `Promoted from insiders build vX.Y.Z-insiders.N`.

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

`scripts/bump-insiders-version.js`:
- `readLatestInsidersTag()` — reads latest `v*-insiders.*` tag via
  `git describe`.
- `resolveBaseVersion()` — uses `semver.gt` to pick the newer of the
  latest insider tag's base and `package.json#version`. This lets
  master sit on a stable version while insider counters increment via
  tags.

## Decision log

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
- **Why tag-only pushes?** Master should not be polluted with release
  ceremony commits (version bumps, lockfile churn). Tags are sufficient
  to retrieve the source. Promotion off an insider tag uses the same
  pattern.
- **Why federated identity instead of a managed identity?** GH-hosted
  runners are outside Azure and cannot host an MI. OIDC federation is
  the equivalent — no long-lived secret to rotate.

## Related docs
- [`../INSIDERS.md`](../INSIDERS.md) — user-facing install instructions
  for testers (intentionally unlinked from the README).
- [`local-auto-update-test.md`](./local-auto-update-test.md) — local
  loopback test for the auto-update flow.
- [`edge-marketplace-install-link-smoke.md`](./edge-marketplace-install-link-smoke.md)
  — Edge install-link smoke test.
