# Insiders Release Checklist — v{{VERSION}}

> Target stable: **v{{TARGET_STABLE}}** · Insider counter: **{{COUNTER}}** ·
> Bump source: **{{BUMP_SOURCE}}** ({{BUMP_KIND}}) · Dispatched: {{DATE}}

This file is the per-release execution record for the **insiders**
channel. It is created from
`.github/skills/release/assets/insiders-checklist.md` by the release
skill at dispatch time and written to
`~/.copilot/session-state/<session-id>/files/release-v{{VERSION}}-insiders-checklist.md`.

It is **not committed to the repository.** It exists so that:

- Every `- [ ]` item below has a matching session todo (kebab-case id
  shown in `[id]`). The skill flips both as it works.
- A session cannot end with `pending` todos for a release in flight.
- The on-disk record survives session checkpoint/restore.

If you are reading this template (not a filled-out copy) the `{{…}}`
placeholders haven't been substituted yet.

---

## Phase 1 — Pre-flight

- [ ] `[preflight-auth]` `gh auth status` succeeds.
- [ ] `[preflight-tree]` Working tree clean (or user explicitly waived).
- [ ] `[preflight-branch]` Dispatching against `origin/master` (insider OIDC is master-scoped).

## Phase 2 — Channel chosen: insiders

- [ ] `[channel-confirmed]` User confirmed `insiders` (Windows-only, invite-only).

## Phase 3a — Compute & dispatch

- [ ] `[compute-version]` Ran `node scripts/bump-insiders-version.js --dry-run`; surfaced target stable, counter, and bump source heading to the user.
- [ ] `[override-decision]` Decided whether to use `--override-bump` (default = derive from `## [Unreleased]`).
- [ ] `[dispatch]` Ran `gh workflow run release-insiders.yml --ref master` (with override if applicable).
- [ ] `[dispatch-confirmed]` `gh run list --workflow=release-insiders.yml --limit 1` shows the new run.
- [ ] `[dispatch-url-surfaced]` Run URL + `gh run watch <id>` command handed to user.

## Phase 3a.4 — After success

- [ ] `[tag-pushed]` New tag `v{{VERSION}}` appears in `git tag -l 'v*-insiders.*' --sort=-v:refname | head -3`.
- [ ] `[install-url-surfaced]` Install URL surfaced to user: <https://chamberinsiders.blob.core.windows.net/releases/Chamber-Setup-latest-insiders.exe>
- [ ] `[update-feed-surfaced]` Auto-update feed surfaced: <https://chamberinsiders.blob.core.windows.net/releases/insiders.yml>
- [ ] `[tester-note]` Reminded user that existing testers auto-update; new testers need the install URL out-of-band.

## Phase 4 — Summary

- [ ] `[summary-written]` Wrote the structured summary block (channel, next tag, audience, install URL, auto-update note, run URL).

---

## Notes

Anything noteworthy from this dispatch — surprises, deviations from the
default flow, items deferred. The skill should append here rather than
leaving the section blank.

-
