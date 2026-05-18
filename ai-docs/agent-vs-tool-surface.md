# Agent vs tool surface — A2A vs ACP

Chamber has two distinct integration surfaces, and they answer two
different questions:

| Surface | Talks to | Answers |
|---------|----------|---------|
| **A2A** (`packages/services/src/a2a`, `ipdelete/a2a-client`) | Other agents (minds) — yours or someone else's, in-process or across the Switchboard relay | "Which **reasoning entity** should think about this?" |
| **ACP** (`packages/services/src/chamberCopilot`, `chamber-copilot-acp-runtime/`) | Tools a mind has been given (e.g. `chamber-copilot`'s `cli_*` surface) | "Which **capability** does the mind use to act on what it decided?" |

Both ship today and they look superficially similar (both are request/response,
both involve a "name" and a "message"). They are not interchangeable.

## The principle

> **Identity is at the mind level. Tools are not addressable.**

A Chamber mind is a reasoning entity with a persistent identity. Other
agents talk to the mind via A2A. The mind reasons about the request and
decides what to do — which may include calling its ACP-backed tools.
ACP is the mechanism by which a mind *does things*. It is not an
addressable peer.

Concretely, when a caller wants chamber-copilot's `cli_*` capability
applied to some work:

1. The caller sends an A2A message to a mind that has chamber-copilot
   wired in as a tool provider.
   `a2a_send_agent_message --recipient <mind-name> ...`
2. The mind reads the message in its own session, with its persona,
   memory, and approval gate intact.
3. If the mind decides the request needs `cli_*`, it invokes the tool
   through `ChamberCopilotService`. ACP is the wire used; the user
   doesn't see it.
4. The mind composes a reply and sends it back via A2A.

The caller addresses the mind, not the tool.

## Why this matters

Several real properties fall out of this separation, and break if you
let tools become A2A-addressable:

- **Single identity per mind.** `a2a_list_agents` lists *minds*. If
  every tool/extension/capability got its own A2A registration, the
  list becomes a flat catalog of every primitive every mind has,
  `from_id` loses meaning, and routing becomes ambiguous ("should I
  message chamber-copilot directly or the mind that uses it?").
- **ApprovalGate stays load-bearing.** Tool invocations flow through
  the mind's approval gate
  (`packages/services/src/chatroom/orchestration/approval-gate.ts`).
  Exposing tools as A2A peers routes around the gate, which is the
  security boundary Chamber owns.
- **Coherent conversations.** Context IDs, turn lifecycles, and the
  reply chain belong to mind-to-mind dialogue. Tool calls are
  intra-turn events on one side of that dialogue; promoting them to
  peers fractures the conversation graph.
- **Cleaner observability.** One trace per mind turn that includes
  "mind called `cli_run`" is easier to read than two parallel traces
  with implicit causality (and risks of orphan tool spans).
- **The mind can substitute, augment, or refuse.** Maybe the mind
  decides the right answer is `web_search`, not `cli_run`. Maybe it
  needs both. Maybe its persona says "don't shell out for that."
  These judgement calls only happen if the request lands at the mind,
  not at the tool.

## Chamber's worked example

`chamber-copilot` is the canonical case:

- **Not** exposed as an A2A agent. It does not appear in
  `a2a_list_agents` and cannot be reached by
  `a2a_send_agent_message`.
- Adopted as a first-class **in-process tool provider via ACP**:
  - `packages/services/src/chamberCopilot/ChamberCopilotService.ts` —
    implements `ChamberToolProvider`, exposes `cli_*` ACP tool
    surface, attached per activated mind.
  - `packages/services/src/chamberCopilot/types.ts` —
    `ChamberCopilotConnectionFactories` for the ACP connection.
  - `chamber-copilot-acp-runtime/` — pinned runtime alongside the
    existing `chamber-copilot-runtime/`.
  - `scripts/prepare-acp-runtime.js`, `scripts/run-acp-smoke-test.js`,
    `scripts/run-acp-desktop-smoke.js` — packaging + smoke
    infrastructure.
  - `apps/desktop/src/main.ts` — `loadChamberCopilot()` runtime-require
    indirection keeps `chamber-copilot` externalized from the desktop
    bundle.
- Consumed as an npm dependency, not as a git submodule under
  `.github/extensions/`.

A previous proposal (closed issue #247) suggested exposing
chamber-copilot through a new `COPILOT_EXTENSION` AgentCard binding +
`ExtensionSessionFactory` subprocess-spawn path. The underlying goal
("Chamber uses chamber-copilot") was met by the tool-provider
integration instead, which is tighter, has no per-call subprocess, and
preserves the principle above.

## When to use which

| Want | Use |
|------|-----|
| Hand a task to another reasoning entity | A2A → a mind |
| Cross-Chamber coordination (your mind ↔ someone else's mind) | A2A via Switchboard relay |
| Multi-agent orchestration inside one Chamber install | A2A in-process (Mind cards in `AgentCardRegistry`) |
| Let a mind shell out to a Copilot CLI capability | ACP via `ChamberCopilotService` (a tool, not a peer) |
| Add a new local capability a mind can invoke | New `ChamberToolProvider` (ACP or another tool surface), wired through the mind's tool set |

## When **not** to add a new A2A binding

Before proposing a new A2A binding (e.g. `COPILOT_EXTENSION`,
`MCP_SERVER`, `CONTAINER_AGENT`), ask: **is this thing a reasoning
entity that should be addressed independently, or is it a capability
some mind invokes?**

If it's a capability, it belongs on the tool surface. The mind that
uses it owns the A2A address; the capability stays behind the gate.
Adding a binding for a non-reasoning thing creates the noise this
document is meant to prevent.

The exception is a **standalone agent that happens to be implemented
on top of a capability** — for example, a fully-autonomous Copilot CLI
session running unattended somewhere and registering as its own A2A
agent. That is a reasoning entity (with its own context, instructions,
and decision loop) and is correctly addressable. The line is
"reasoning entity vs invocation surface," not "where the bytes
execute."

## Related

- [`release-channels.md`](./release-channels.md) — Model B + Pattern E
  release flow.
- [`feature-flags.md`](./feature-flags.md) — remote feature-flag policy.
- `packages/services/src/a2a` — A2A implementation
  (`AgentCardRegistry`, `MessageRouter`, `TaskManager`).
- `packages/services/src/chamberCopilot` — ACP-backed tool provider.
- [`ipdelete/a2a-client`](https://github.com/ipdelete/a2a-client) —
  Switchboard relay client extension (the A2A wire we use across
  Chamber installs).
- Closed issue #247 — the proposal this doc is meant to prevent
  re-deriving from scratch.
