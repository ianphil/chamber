# Stable Release Checklist — v{{VERSION}}

> Flow: **{{FLOW}}** ({{FLOW_DESCRIPTION}}) · Source: **{{SOURCE_REF}}** ·
> Build SHA: **{{BUILD_SHA}}** · Dispatched: {{DATE}}

This file is the per-release execution record for the **stable**
channel. It is created from
`.github/skills/release/assets/stable-checklist.md` by the release
skill at dispatch time and written to
`~/.copilot/session-state/<session-id>/files/release-v{{VERSION}}-stable-checklist.md`.

It is **not committed to the repository.** It exists so that:

- Every `- [ ]` item below has a matching session todo (kebab-case id
  shown in `[id]`). The skill flips both as it works.
- A session cannot end with `pending` todos for a release in flight —
  in particular **Phase 3b.7 (post-release bump PR) cannot be silently
  skipped** the way it was for v0.63.0.
- The on-disk record survives session checkpoint/restore.

If you are reading this template (not a filled-out copy) the `{{…}}`
placeholders haven't been substituted yet.

---

## Phase 1 — Pre-flight

- [ ] `[preflight-auth]` `gh auth status` succeeds.
- [ ] `[preflight-tree]` Working tree clean (or user explicitly waived).
- [ ] `[preflight-branch]` Dispatching against `origin/master`.

## Phase 2 — Channel chosen: stable

- [ ] `[channel-confirmed]` User confirmed `stable` (public, full platforms).

## Phase 3b.1 — Flow

- [ ] `[flow-chosen]` Picked Flow A (emergency from master) or Flow B (promote insider tag). Default = B.

## Phase 3b.2 — Pre-flight for the chosen flow

- [ ] `[insider-tag-listed]` (Flow B) Listed recent insider tags and confirmed `{{SOURCE_REF}}` with user.
- [ ] `[stable-tag-absent]` Confirmed `v{{VERSION}}` does **not** already exist (`git tag -l v{{VERSION}}` empty).
- [ ] `[unreleased-non-empty]` (Flow A only) Confirmed `## [Unreleased]` has actionable entries.

## Phase 3b.3 — Stable feature flag graduation

- [ ] `[flags-current]` Read current `docs/flags/v1/flags.json` and the published <https://chmbr.dev/flags/v1/flags.json>.
- [ ] `[flags-decided]` Asked user which flags graduate to stable. Default = none.
- [ ] `[flags-pr]` (If any graduating) Opened the small `Update stable feature flags` PR, ran the targeted vitest + markdownlint, and waited for the user to merge it.
- [ ] `[flags-published]` (If any graduating) Verified the published policy at <https://chmbr.dev/flags/v1/flags.json> reflects the intended stable values.

## Phase 3b.4 — macOS notary warmup

- [ ] `[notary-status]` Confirmed macOS notarization warmup is complete (recent submissions <5 min), **or** user explicitly chose Windows-only stable (`STABLE_RELEASE_BUILD_MACOS=false` set/verified), **or** stable deferred until warmup completes.

## Phase 3b.5 — Dispatch

- [ ] `[dispatch]` Ran `gh workflow run release.yml --ref master` with the chosen `source_ref` (Flow B) or no source_ref (Flow A).
- [ ] `[dispatch-confirmed]` `gh run list --workflow=release.yml --limit 1` shows the new run.
- [ ] `[dispatch-url-surfaced]` Run URL + `gh run watch <id>` command handed to user.

## Phase 3b.6 — After success (async-coupled — DO NOT SKIP)

> Stable builds take 30–60 min (longer with macOS notary warmup). The
> dispatching session typically ends before the run completes. **The
> next two items are the most-skipped step in the whole flow** —
> v0.63.0 shipped without them and master was left at 0.62.4 until
> caught by hand a day later. Treat them as load-bearing.

- [ ] `[release-tag-present]` `git fetch origin --tags --quiet && gh release view v{{VERSION}}` shows the release.
- [ ] `[release-url-surfaced]` GitHub Releases URL surfaced to user.
- [ ] `[two-tags-noted]` (Flow B) Reminded user that `v{{VERSION}}` and `{{SOURCE_REF}}` point at the same commit by design.
- [ ] `[stale-pkg-noted]` Reminded user that `git checkout v{{VERSION}}` will show master's stale `package.json` until the bump PR merges.

## Phase 3b.7 — Post-release bump PR (the one we always forget)

> **`.github/workflows/post-release-bump.yml` should have opened this
> PR automatically on stable tag push.** These items confirm the
> automation actually ran; if it didn't, fall through to the manual
> path.

- [ ] `[auto-workflow-ran]` `gh run list --workflow=post-release-bump.yml --limit 3` shows a successful run for tag `v{{VERSION}}`.
- [ ] `[auto-pr-opened]` `gh pr list --head release/bump-v{{VERSION}}` shows the bump PR.
- [ ] `[auto-pr-url-surfaced]` Bump PR URL surfaced to user for review.
- [ ] `[manual-fallback-if-needed]` (Only if the workflow failed or didn't fire) Ran the manual sequence: branch from `{{BUILD_SHA}}`, `npm version {{VERSION}} --allow-same-version`, `promoteUnreleasedToVersion`, commit with `Build-SHA:` + `Source-Ref:` trailers, push, `gh pr create`. Surfaced PR URL.

## Phase 4 — Summary

- [ ] `[summary-written]` Wrote the structured summary block (channel, version, release URL, two-tag note, bump-PR URL).

---

## Notes

Anything noteworthy from this dispatch — surprises, deviations from the
default flow, items deferred. The skill should append here rather than
leaving the section blank.

-
