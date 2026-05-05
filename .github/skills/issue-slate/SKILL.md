---
name: issue-slate
description: Batch workflow for Chamber issue slates. Use this when the user asks to work through a group of GitHub issues by label, priority, milestone, or explicit issue list. It triages the slate, groups issues into small PRs/stacks, creates a roadmap and todos, then executes each item with a TDD mini-plan and the Chamber ship skill.
---

# Issue Slate Skill

Drive a labeled or explicitly supplied GitHub issue slate from triage through reviewable PRs.

This skill coordinates the Chamber `ship` skill. Use `gh` for all GitHub operations. Never use MCP. The default base branch is `master`, and the default repository is `ianphil/chamber`.

## When to use

Use this skill when the user asks to:

1. Work through all issues with a label such as `now`, `next`, or `later`.
2. Turn a set of GitHub issues into an execution plan.
3. Create several PRs from an issue batch.
4. Run the Chamber loop of **plan -> do -> ship** repeatedly.
5. Generalize, replay, or continue a prior issue-slate workflow.

Do not use this skill for a single already-scoped PR. Use the `ship` skill directly for that.

## Defaults

- User: `ianphil`.
- Repository: `ianphil/chamber`.
- Base branch: `master`.
- Labels are priority buckets: `now`, `next`, `later`.
- Default slate label: ask if unclear; otherwise use the label named by the user.
- Prefer Git Town stacks for slate execution. Independent PRs are the exception, not the default, when every PR needs release metadata.
- Use `gh` for issue and PR operations.
- Never use MCP.
- Do not run `npm run make:sandbox`.
- If packaging/runtime smoke is needed, use `npm run package` instead.
- Run `npm run lint` and `npm test` for each PR through the `ship` skill.
- Use the narrowest existing runtime smoke that proves the changed surface still runs.
- Run Uncle Bob for non-trivial, runtime, architectural, or security-sensitive PRs, and fix critical findings.
- Include `Closes #NNN` or `Fixes #NNN` for every issue intentionally addressed by a PR.
- Let the `ship` skill recommend the version bump, then accept the recommendation unless the user gives a reason to override. For a stack, apply sequential version bumps down the stack so child PRs do not duplicate parent release metadata.
- Draft and apply a matching `CHANGELOG.md` entry for every non-trivial PR.
- Do not merge PRs unless the user explicitly asks. Creating reviewable PRs is the default end state.

## Autopilot defaults

Issue-slate work is intended to run without repeated user intervention after the slate is confirmed. Record these defaults in the roadmap and pass them to the `ship` skill for every PR:

| Prompt area | Default answer |
|---|---|
| Version bump | Accept the LLM/agent recommendation; in stacks, use the next sequential version after the parent branch. |
| Changelog | Draft and apply automatically using the existing format. |
| Closing issue | Include all issues covered by the PR group. |
| Uncle Bob | Run automatically for non-trivial/runtime/security/architecture changes; skip for docs/tests/simple UI fixes. |
| Packaging sandbox | Never run `npm run make:sandbox`; use `npm run package` only when packaging/startup paths changed. |
| PR base | Use the stack parent branch for child PRs, otherwise `master`. |

Do not ask these questions again per PR unless the implementation discovers ambiguity, failures, or a scope change. Merging remains a human gate unless Ian explicitly says to merge approved PRs as they pass.

## Smoke-test defaults

Choose the narrowest smoke command that proves the changed path:

| Changed area | Default smoke |
|---|---|
| Desktop startup, installer, Forge, packaging config, app icons | `npm run package` |
| Packaged server/web routing | `npm run smoke:packaged` |
| Copilot SDK session/runtime paths | `npm run smoke:sdk` |
| Server SDK paths | `npm run smoke:server` |
| Browser UI routing or chat flow | `npm run smoke:web` when covered |

Do not invent new smoke scripts. If no existing smoke covers the path, document the closest executable verification and ask before broadening scope.

## Phase 1 - Discover and triage the slate

1. Verify the local branch and working tree:

   ```powershell
   git --no-pager status --short --branch
   ```

   If the tree is dirty, stop and ask the user whether to commit, stash, or abort.

2. Sync issue metadata with `gh`:

   ```powershell
   gh issue list --repo ianphil/chamber --state open --label <label> --limit 100 --json number,title,labels,state,url,updatedAt
   gh issue list --repo ianphil/chamber --state all --limit 100 --json number,title,labels,state,url,updatedAt
   ```

3. Check whether all relevant issues have exactly one priority label from `now`, `next`, and `later`.

4. Identify stale, duplicate, already-fixed, invalidated, or superseded issues. Do not close or relabel without user approval.

5. Cluster issues into likely PR groups. Prefer small PRs, but group issues when they share one root cause or one coherent behavior.

6. Identify dependencies and stack candidates:

   - Default to one short Git Town stack for a 2-5 issue slate that is intended to land in order.
   - For larger slates, create several short stacks, one per cluster.
   - Independent PRs are allowed for design-heavy, uncertain, urgent, or intentionally deferred-version work.
   - Avoid one long stack across unrelated clusters.
   - Use the repo's automatic branch deletion/retargeting behavior: merge stack parents first, then let GitHub retarget child PRs to `master`.

7. Choose the release metadata strategy for the slate:

   - **Stacked release metadata** (default): parent PR gets the next version, each child gets the next sequential version. This avoids duplicate `package.json`, lockfile, and changelog bumps.
   - **Deferred release metadata**: later independent PRs skip version/changelog until their predecessor merges.
   - **Preallocated independent versions**: independent PRs get sequential versions up front only when merge order is fixed and the user explicitly chooses this.

8. Present a concise slate proposal and ask for confirmation before creating the roadmap when the grouping, stack order, or release metadata strategy is ambiguous.

## Phase 2 - Create the roadmap

Create or update the session roadmap at the current session plan path. The roadmap must include:

1. Goal and scope.
2. Global defaults and merge policy.
3. PR stack map.
4. One section per PR group with:
   - Branch name.
   - Base branch.
   - Covered issue numbers.
   - Scope.
   - Ship skill notes.
   - TDD mini-plan placeholder.
5. Execution workflow.
6. Open questions.

Branch naming:

- `fix/<short-desc>-<issue-number>` for fixes.
- `feat/<short-desc>-<issue-number>` for features.
- For grouped issues, include the lead issue number and any essential paired issue numbers.

## Phase 3 - Mirror todos

Create one todo per planned PR group. Add dependencies for stacked PRs.

Todo IDs should be stable and descriptive, for example:

```text
pr-repo-hygiene-141
pr-genesis-chat-ready-context-92-30
pr-duplicate-mind-session-tools-33
```

Mark each todo `in_progress` before starting it and `done` after its PR is open and clean.

## Phase 4 - Execute each PR group

For each ready todo, run the loop below. Do not start the next PR until the current PR is open, pushed, and recorded in the roadmap.

### 1. Sync and branch

For independent work:

```powershell
git switch master
git fetch origin master --quiet
git pull --ff-only origin master
git switch -c <branch>
```

For stacked work, prefer Git Town when available:

```powershell
git town hack <parent-branch>
git town append <child-branch>
git town sync
```

When Git Town is unavailable and the user does not want to install it, use manual stacked branches:

```powershell
git switch <parent-branch>
git switch -c <child-branch>
```

Do not install new stack tooling without user approval.

### 2. Create stacked PR bases

Open each PR against its stack parent:

- Root PR: `gh pr create --base master --head <parent-branch>`.
- Child PR: `gh pr create --base <parent-branch> --head <child-branch>`.

Merge stack parents first. Because the repo deletes merged head branches, GitHub should retarget child PRs to `master`; verify this after each merge.

### 3. Inspect the issue and code

Read the GitHub issue body and comments:

```powershell
gh issue view <issue-number> --repo ianphil/chamber --comments
```

Inspect the nearest code, tests, and docs before editing. Follow existing Chamber conventions.

### 4. Write the TDD mini-plan

Before implementation, update the roadmap section for this PR group with:

1. The behavior being proven.
2. The failing automated test, focused smoke, or executable repro to write or observe first.
3. The minimal implementation path.
4. The focused tests, full checks, and runtime smoke that prove completion.

### 5. Red phase

Write the smallest failing test first whenever practical.

If the defect cannot be reproduced in an automated test, capture the closest executable smoke/repro before changing production code. Do not use that exception to skip validation.

### 6. Green phase

Implement surgically until the focused test passes. Keep changes limited to the PR group's scope. Do not fix unrelated pre-existing issues.

### 7. Refactor and validate

Run focused tests during development, then run the appropriate smoke command for changed runtime surfaces.

The `ship` skill will run the full required checks, but do not hand it a known-broken branch.

### 8. Commit

Commit with a conventional title and the required trailer:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

### 9. Invoke the ship skill

Run the Chamber `ship` skill for the current branch in autopilot mode. Carry forward these answers unless the user overrides them:

| Prompt area | Default answer |
|---|---|
| Version bump | Accept the skill recommendation; in stacks, use the next sequential version after the parent branch |
| Changelog | Draft/apply the matching entry |
| Closing issue | Include all covered issues |
| Uncle Bob | Yes for non-trivial/runtime/security/architecture changes |
| Packaging sandbox | No; use `npm run package` when packaging smoke is needed |

For child branches, explicitly tell the `ship` skill that the PR base is the parent branch, not `master`. If the skill still creates the PR against `master`, immediately fix the base with:

```powershell
gh pr edit <pr-number> --repo ianphil/chamber --base <parent-branch>
```

### 10. Record result

After the PR is open:

1. Add the PR URL to the roadmap.
2. Record any changed dependency or follow-up.
3. Mark the todo `done`.
4. Move to the next ready todo.

## Phase 5 - Human merge gate

Do not merge by default.

When the user explicitly approves a PR merge:

1. Verify checks are green:

   ```powershell
   gh pr checks <pr-number> --repo ianphil/chamber
   ```

2. Admin squash merge only if the user asks for admin merge:

   ```powershell
   gh pr merge <pr-number> --repo ianphil/chamber --admin --squash --delete-branch
   ```

3. Pull latest `master`:

   ```powershell
   git switch master
   git pull --ff-only origin master
   ```

4. For stacked child PRs, verify GitHub retargeted correctly. If needed, rebase the child branch and update its base with `gh pr edit --base`.

## Phase 6 - Closeout

At the end of a slate:

1. Verify the original issue set is closed or intentionally deferred.
2. Verify no open issue unexpectedly remains with the slate label:

   ```powershell
   gh issue list --repo ianphil/chamber --state open --label <label> --limit 100
   ```

3. Confirm all PR URLs are recorded in the roadmap.
4. If appropriate, propose the next slate by promoting issues from `next` to `now`, but do not relabel without user approval.

## Failure modes

- Dirty tree before starting: stop and ask.
- Ambiguous issue grouping: ask before planning.
- Rebase conflict: stop and surface conflicts.
- Failing focused test after implementation attempt: debug; if still failing, stop with evidence.
- Failing lint/test/smoke: stop, show the failure, do not open or merge the PR.
- Security-sensitive finding from Uncle Bob: address or ask before proceeding.
- PR checks fail after opening: fix the branch before asking the user to merge.
- User asks to merge but checks are red: do not merge unless the user explicitly confirms the risk after seeing the failures.

## Notes

- Last proven shape: the 2026-04-27 `now` slate used this pattern to produce PRs #149-#155, with PR #137 closing two stale items before execution and PR #156 handling release follow-up.
- Keep the roadmap lightweight, but keep each PR mini-plan specific. The value is in repeating small, reviewable loops rather than doing one giant implementation pass.
- Prefer transparency over automation magic. The agent owns orchestration; GitHub remains the source of truth for issues and PRs.
