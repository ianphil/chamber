# Roadmap — teamMemory learning loop (weeks 1–3)

> **Status**: draft slate. Issues filed; implementation not started. This document is the slate's persistent record.

## Goal

Close the gap between Chamber's current file-based teamMemory and the
"persistent agents that learn a developer's standards, preferences, and
constraints over time" claim. Deliver in three weeks:

1. **Week 1** — teamMemory becomes **observed** at turn time and at
   delegation time, and chamber-copilot's policy + verify seams ship
   sensible Chamber-side defaults so guardrails are on by design.
2. **Week 2** — a scribe observer pass extracts proposed preference
   deltas from each turn, and the operator confirms them through an
   accept/reject UI. The "learns from operators" claim becomes
   demonstrable with an artifact (`proposals.journal.ndjson` →
   `rules.md` / `decisions.md`).
3. **Week 3** — chamber-copilot job outcomes (verify failures,
   approval rejects) feed the same observer, closing the end-to-end
   loop. Optional stretch: cross-mind team knowledge share via A2A
   relay.

## Scope (in)

- `packages/services/src/teamMemory/` — new modules (`promptContext`,
  `observer`, `proposals`, `teamSync`).
- `packages/services/src/chamberCopilot/` — new modules
  (`teamMemoryGuard`, `policyLoader`, `verifyResolver`); changes to
  `MindScopedJobs.ts`.
- `packages/services/src/chat/ChatService.ts` — turn-time injection
  and observer trigger.
- `apps/web/src/renderer/components/teamMemory/` — read-only panel +
  proposal tray.
- `apps/desktop/src/main/ipc/teamMemory.ts` (new) — IPC channels.
- `resources/chamberCopilot/default-policy.yaml` (new) — packaged
  default policy.

## Scope (out)

- ML-based preference learning (LLM-summarization + operator
  confirmation is sufficient).
- Auto-apply of proposals (operator approval is the gate by design).
- chamber-copilot runtime changes — none expected; see
  [chamber-copilot tracking issue #285](https://github.com/patschmitt91/chamber-copilot/issues/285).
- Authoring UI for `policy.yaml`.

## Autopilot defaults (carry into the `ship` skill)

| Prompt area | Default answer |
|---|---|
| Version bump | Accept `ship` recommendation; sequential for stacked PRs. |
| Changelog | Draft + apply automatically using existing format. |
| Closing issue | Include `Closes #N` for every issue addressed. |
| Uncle Bob | Run for all `packages/services/**` changes; skip docs-only PRs. |
| Smoke | `npm run smoke:sdk` for #345, #346, #349, #351 (touch the SDK turn path). `npm run smoke:web` for #348, #350 (renderer). `npm run smoke:desktop` for #347 (packaged policy resource). |
| Packaging sandbox | Never run. |
| PR base | `master` (independent PRs — slate stacking is overkill at this size). |

Merging stays a human gate.

## Cross-repo

- **chamber-copilot tracking epic**:
  [patschmitt91/chamber-copilot#285](https://github.com/patschmitt91/chamber-copilot/issues/285) —
  pins the chamber-copilot seams this slate consumes (`preDelegateGuard`,
  `JobStore` status events, `lastVerify` snapshot, `cli_approve` decision
  codes, `MindTrustScorer.record/tier`, `PolicyEngine.evaluate`). No
  chamber-copilot code changes expected.

## PR map

```text
345 promptContext.ts                                 → ChatService injects teamMemory
   ├──► 346 teamMemoryGuard.ts                       → MindScopedJobs default preDelegateGuard
   ├──► 347 policyLoader + verifyResolver            → MindScopedJobs default policy + verify
   ├──► 348 TeamMemoryPanel.tsx                      → renderer surfaces rules + decisions
   └──► 349 observer.ts                              → post-turn scribe proposes deltas
        └──► 350 ProposalTray.tsx                    → operator accepts/rejects
             └──► 351 job-outcome feedback           → MindScopedJobs feeds observer
                  └──► 352 teamSync.ts (stretch)     → A2A relay for cross-mind share
```

Independent PRs (no Git Town stack). Logical dependency edges captured
in the per-issue "Dependencies" sections.

## Slate items

### Week 1 — defaults that make the email's claims defensible

#### #345 — teamMemory prompt injection

- **Branch**: `feat/teammemory-prompt-injection`
- **Base**: `master`
- **Issue**: [#345](https://github.com/ianphil/chamber/issues/345)
- **TMLST design checkpoint**: not applicable — pure additive read of
  existing files, no trust-boundary widening.
- **TDD mini-plan**: see issue #345.
- **Ship skill notes**: `enhancement`; default smoke `npm run smoke:sdk`.

#### #346 — default `preDelegateGuard` from teamMemory

- **Branch**: `feat/chambercopilot-default-pre-delegate-guard`
- **Base**: `master`
- **Issue**: [#346](https://github.com/ianphil/chamber/issues/346)
- **Depends on**: #345.
- **TMLST design checkpoint**: consumer of the chamber-copilot
  `preDelegateGuard` seam. Does not change the seam contract. If
  chamber-copilot tightens the contract during this slate, coordinate
  via tracking issue #285.
- **TDD mini-plan**: see issue #346.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:sdk`.

#### #347 — default policy.yaml + verify for `MindScopedJobs`

- **Branch**: `feat/chambercopilot-default-policy-and-verify`
- **Base**: `master`
- **Issue**: [#347](https://github.com/ianphil/chamber/issues/347)
- **TMLST design checkpoint**: ships a default `policy.yaml` in
  `audit` mode (logs, does not block). Defines no new trust boundary;
  consumes the existing `PolicyEngine.evaluate` contract.
- **TDD mini-plan**: see issue #347.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:desktop`
  to verify the packaged resource ships.

#### #348 — renderer panel for team memory (read-only)

- **Branch**: `feat/team-memory-ui-panel`
- **Base**: `master`
- **Issue**: [#348](https://github.com/ianphil/chamber/issues/348)
- **TMLST design checkpoint**: not applicable — renderer-only,
  read-only.
- **TDD mini-plan**: see issue #348.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:web`.

### Week 2 — the scribe + the operator confirmation flow

#### #349 — post-turn observer pass proposes deltas

- **Branch**: `feat/scribe-mind-observer-pass`
- **Base**: `master`
- **Issue**: [#349](https://github.com/ianphil/chamber/issues/349)
- **Depends on**: #345, #348.
- **TMLST design checkpoint**: introduces a new write surface
  (`proposals.journal.ndjson`). The surface is **operator-confirmed-write**
  by design — the observer cannot mutate `rules.md` or `decisions.md`
  directly. Marked load-bearing; covered by observer persistence tests
  and an integration test in #349.
- **TDD mini-plan**: see issue #349.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:sdk`.

#### #350 — operator accept/reject for proposed deltas

- **Branch**: `feat/operator-confirmed-preference-deltas`
- **Base**: `master`
- **Issue**: [#350](https://github.com/ianphil/chamber/issues/350)
- **Depends on**: #349, #348.
- **TMLST design checkpoint**: acceptance path MUST flow through
  existing `appendRule` / `appendDecision` writers so consolidation
  and dedup invariants hold for both human-written and accepted-from-scribe
  entries. Covered by an integration test that round-trips
  proposal → accept → `readRules` sees it.
- **TDD mini-plan**: see issue #350.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:web`.

### Week 3 — close the loop with chamber-copilot outcomes

#### #351 — feed chamber-copilot job outcomes into the observer

- **Branch**: `feat/copilot-outcome-feedback-loop`
- **Base**: `master`
- **Issue**: [#351](https://github.com/ianphil/chamber/issues/351)
- **Depends on**: #349 (#350 strongly recommended so the resulting
  proposals are actionable).
- **TMLST design checkpoint**: consumer of chamber-copilot's
  `JobStore` status-change events and `lastVerify` snapshot field. Does
  not change either contract. Coalesces identical outcomes within a
  24h window so the observer is not fed a flood of duplicates.
- **TDD mini-plan**: see issue #351.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:sdk`.

#### #352 — cross-mind team knowledge share via A2A relay (stretch)

- **Branch**: `feat/cross-mind-team-knowledge-share`
- **Base**: `master`
- **Issue**: [#352](https://github.com/ianphil/chamber/issues/352)
- **Status**: **stretch** — drop from the slate if weeks 1–2 over-run.
- **Depends on**: #349, #350.
- **TMLST design checkpoint**: published payload is sanitized,
  size-bounded, and goes only to explicitly-configured `teamId`s.
  Pulled rules/decisions arrive as **proposals**, never as direct
  writes, so the operator-confirmed-write invariant from #349/#350
  extends across the boundary.
- **TDD mini-plan**: see issue #352.
- **Ship skill notes**: `enhancement`; smoke `npm run smoke:sdk`.

## Execution workflow

For each ready slate item (no unmet dependency), repeat:

1. `git switch master && git pull --ff-only origin master`
2. `git switch -c <branch>`
3. Read the issue and the nearest sibling code; copy its shape.
4. Write the failing test(s) per the issue's TDD plan.
5. Implement minimally; do not fix unrelated pre-existing issues.
6. Run focused tests, then `npm run lint && npm test`, then the chosen
   smoke.
7. Commit with `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
8. Invoke the chamber `ship` skill in autopilot mode using the
   defaults above; pass `Closes #N`.
9. Record the PR URL in this roadmap; mark the slate todo `done`.

## Open questions

- **Observer model choice (#349)** — which model does the scribe use?
  Cheapest viable wins. Configurable per mind. Default = the same model
  the mind is currently configured for, unless a `scribeModel` is set.
- **Proposal staleness (#350)** — should proposals auto-expire after N
  days if unresolved? Probably yes (default 14 days, configurable).
- **Cross-repo coordination cadence (#347, #351)** — any
  chamber-copilot seam tightening during this slate must surface in
  tracking issue [#285](https://github.com/patschmitt91/chamber-copilot/issues/285).
  If a tightening would break #347 or #351, the chamber slate stalls
  until coordinated.
- **Stretch decision (#352)** — make the call at end of week 2 based
  on burn-down.

## Closeout criteria

- All eight chamber issues #345–#352 are closed or intentionally
  deferred (with deferral noted on the issue).
- chamber-copilot tracking issue [#285](https://github.com/patschmitt91/chamber-copilot/issues/285)
  is closed with a one-paragraph summary of any cross-repo changes
  actually required.
- A demo path exists end-to-end: open Chamber → activate a mind →
  have a conversation that triggers an observer proposal → accept it
  → run a delegated job whose verify-gate failure also triggers a
  proposal → accept it → restart the mind and see the accepted
  rules/decisions injected into the next turn.

## Provenance

This slate exists to close gaps between the email pitched to Will Guyman
(via Lorraine Bardeen's introduction) and the artifacts currently in
the chamber + chamber-copilot repos. The audit that produced this slate
is summarized in the linked tracking epic.
