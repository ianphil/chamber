---
name: ship
description: End-to-end shipping workflow for the Chamber repo. Use this when the user asks to ship, prepare, open, finalize, land, or create a PR. It rebases on the target base, applies version/changelog defaults, links closing issues, runs smoke tests, optionally reviews with Uncle Bob, and creates the PR via `gh`. Supports issue-slate autopilot defaults for batched work.
---

# Ship Skill

Drive Chamber work from a feature branch to a clean, reviewable pull request. This skill replaces the older `pr` workflow name; use it for "ship", "ship it", "open a PR", "prepare this PR", "finalize", "land this branch", and related shipping requests.

The user is `ianphil`. The default base branch is `master` unless a caller supplies a stack parent branch. Commits must include the Chamber Co-authored-by trailer. Use `gh` for all GitHub operations. Never use MCP.

## Modes

### Interactive mode

Use interactive mode for one-off user requests when defaults were not already approved. In this mode, ask before applying version bumps, changelog entries, Uncle Bob review, and optional packaging smoke.

### Autopilot mode

Use autopilot mode when:

1. The `issue-slate` skill invokes this skill with confirmed slate defaults.
2. The user explicitly says to run on autopilot, ship the slate, or use defaults.
3. A roadmap already records the answers for versioning, changelog, closing issues, review, and smoke policy.

In autopilot mode, do not stop for repeated confirmation prompts. Apply these defaults automatically:

| Prompt area | Autopilot default |
|---|---|
| Version bump | Accept the LLM/agent recommendation. For stacks, use the next sequential version after the parent branch. |
| Changelog | Draft and apply the matching entry using the existing format. |
| Closing issue | Include all planned issue refs from the roadmap or branch commit messages. |
| Uncle Bob | Run for non-trivial, runtime, architecture, SDK, security, or broad behavior changes; skip for small docs, tests, and focused UI fixes. |
| Packaging sandbox | Do not run `npm run make:sandbox`; use `npm run package` only when packaging/startup paths need smoke coverage. |
| PR base | Use the supplied stack parent branch; otherwise use `master`. |

Autopilot still stops for dirty working trees, being on `master`, rebase conflicts, ambiguous release ordering, failing checks, destructive operations, serious review findings, missing issue refs, or anything that would merge code. Opening a PR is allowed; merging still requires explicit user approval.

## Prerequisites

Before doing anything, verify:

1. `git status` is clean. If dirty, ask the user whether to commit, stash, or abort.
2. The current branch is **not** `master`. If it is, abort.
3. `gh auth status` succeeds.
4. The intended PR base is known:
   - `master` for independent/root PRs.
   - The parent branch for stacked PRs.

## Workflow

Run these phases in order. Phases marked **ASK** ask only in interactive mode. In autopilot mode, apply the supplied/default answer and report what was done.

### 1. AGENT - Rebase on the intended base

For independent/root PRs:

```powershell
git fetch origin master --quiet
git rebase origin/master
```

For stacked child PRs:

```powershell
git fetch origin <parent-branch> --quiet
git rebase origin/<parent-branch>
```

If the rebase has conflicts, stop and surface them. Do not attempt automatic resolution unless the user explicitly approves.

### 2. ASK/AUTOPILOT - Version bump recommendation

Inspect the diff against the intended base:

```powershell
git --no-pager diff <base-ref> --stat
git --no-pager diff <base-ref> -- <changed-files>
```

Recommend **patch** vs **minor** vs **none** based on:

- **patch** - bug fixes, internal refactors, doc-only or test-only changes.
- **minor** - new user-visible feature, new mind capability, new Lens view type, new cron job kind, new tool, schema additions.
- **major** - breaking changes. Chamber is pre-1.0, so prefer minor with a clear changelog warning unless the break is intentional.

Interactive mode: use `ask_user` to confirm the bump.

Autopilot mode: apply the recommendation automatically. For issue-slate stacks, do not duplicate a parent branch version; choose the next sequential version already implied by the stack order. Then run:

```powershell
npm version <patch|minor|major> --no-git-tag-version
npm install --package-lock-only
```

Stage `package.json` and `package-lock.json`.

### 3. ASK/AUTOPILOT - Changelog check

Read `CHANGELOG.md`. Confirm the top section matches the new version and describes the change.

Interactive mode: if missing or stale, draft an entry and ask before writing it.

Autopilot mode: write the entry directly, following the existing format:

```markdown
## vX.Y.Z (YYYY-MM-DD)

### Area

- **Bold one-line summary** - concise detail with issue refs.
```

### 4. AGENT - Closing issue check

Inspect commit messages and the roadmap/branch context:

```powershell
git --no-pager log <base-ref>..HEAD --oneline
```

Use `Closes #NNN` or `Fixes #NNN` for each issue intentionally addressed by this PR.

Interactive mode: if the closing relationship is plausible but not explicit, ask the user.

Autopilot mode: include roadmap-provided issue refs and explicit commit refs automatically. Stop only if no issue ref is known for issue-driven work.

### 5. ASK/AUTOPILOT - Uncle Bob review

Run Uncle Bob for non-trivial, runtime, architecture, SDK, security, or broad behavior changes. Skip for small docs, tests, and focused UI fixes.

When running it, delegate via the `task` tool with `agent_type: "Uncle Bob"` and pass:

- the diff range (`<base-ref>..HEAD`)
- the list of changed files
- a request for focused critique, not style nits

Surface the findings. In autopilot mode, fix critical findings directly when the fix is clearly in scope; otherwise stop and ask.

### 6. AGENT - Smoke tests

Run, in order, surfacing any failure immediately:

```powershell
npm run lint
npm test
```

If an SDK-touching path was modified, also run:

```powershell
npm run smoke:sdk
```

If server SDK paths changed, also run:

```powershell
npm run smoke:server
```

If browser UI routing/chat paths changed and existing coverage applies, run:

```powershell
npm run smoke:web
```

### 7. ASK/AUTOPILOT - Packaging smoke

Do not run `npm run make:sandbox` in issue-slate autopilot.

If the diff touches packaging, runtime wiring, the Copilot runtime, Electron Forge config, installer/app icons, or first-launch behavior, run:

```powershell
npm run package
```

Interactive mode: ask before packaging smoke unless the user already requested it.

Autopilot mode: run `npm run package` automatically when the changed surface requires it; otherwise skip and record why.

### 8. AGENT - Push and open the PR

Push the branch:

```powershell
git push -u origin HEAD
```

Open the PR with the intended base:

```powershell
gh pr create --base <base-branch> --head <branch> --title "<title>" --body "<body>"
```

The PR body must include:

- A short summary.
- Notable changes.
- The `Closes #NNN` / `Fixes #NNN` lines.
- Test evidence.
- Any skipped smoke with the reason.

Print the resulting PR URL.

## Failure modes

- **Dirty tree** - stop and ask.
- **Current branch is `master`** - abort.
- **Unknown PR base** - ask.
- **Rebase conflicts** - stop, surface conflicts, ask for direction.
- **Version ordering ambiguity** - stop and ask.
- **Lint, test, or smoke failure** - stop, show the failure, do not push.
- **Critical Uncle Bob finding** - fix if clearly in scope; otherwise ask.
- **No changelog entry for a non-trivial change** - block until one exists.
- **Dirty working tree at the end** - never push with uncommitted changes.

## Notes

- Chamber's CI lives in `.github/workflows/ci.yml` and `governance-check.yml`. Local smoke tests are not a substitute, but they catch most regressions before push.
- The Co-authored-by Copilot trailer is mandatory.
- Never modify `.working-memory/` files in a PR. They are agent-managed.
- This skill opens PRs; it does not merge them unless the user explicitly asks for a merge.
