# AGENTS.md - Chamber Agent Governance

## Overview

Chamber is a desktop application where AI agents ("minds") operate as a Chief of Staff. Agents connect via the GitHub Copilot SDK and can extend the UI, execute tool calls, modify data, and run scheduled jobs.

## Agent Capabilities

### Minds
- **Identity**: Each mind has a name, personality, and persistent memory
- **Tool access**: Minds invoke tools via the Copilot SDK (model-driven tool calls)
- **Lens views**: Minds can create `view.json` files in `.github/lens/` to extend the UI with 7 view types (form, table, briefing, detail, status-board, timeline, editor)
- **Write-back**: Minds can modify data through the action bar on any Lens view
- **Canvas**: Minds can render HTML dashboards, reports, and forms in a browser with live reload
- **Cron**: Minds can schedule prompt, process, webhook, and notification jobs

### Chatroom (Multi-Agent)
- **Concurrent**: All agents respond in parallel
- **Sequential**: Round-robin turns
- **GroupChat**: Moderator-directed conversation
- **Handoff**: Agent-to-agent delegation
- **Magentic**: Manager-driven task ledger

## Security Boundaries

### Credential Storage
- Credentials stored via `keytar` (OS-native keychain)
- Never store credentials in mind directories or `.working-memory/`

### Tool Execution
- All tool calls flow through the Copilot SDK
- Approval gate (`approval-gate.ts`) provides tool execution review
- Observability layer (`observability.ts`) emits structured events with redaction

### Desktop Considerations
- Close-to-tray means agents may run unattended
- electron-builder/electron-updater releases must verify Azure Trusted Signing signatures and `latest.yml` must match the final signed installer bytes
- Mind directories are user-local; do not share across untrusted users

## Coding Agent Instructions

When contributing to Chamber:
- Do not commit secrets, tokens, or credentials
- Do not modify `.working-memory/` files in PRs (agent-managed)
- Validate all `view.json` files against the Lens schema before rendering
- Canvas HTML rendering must be sandboxed (no access to Electron main process APIs)
- Cron job definitions must not allow arbitrary shell execution
- Tool call responses must be sanitized before display in chat UI
- Multi-agent chatroom changes require review of orchestration safety (delegation limits, approval gates)
