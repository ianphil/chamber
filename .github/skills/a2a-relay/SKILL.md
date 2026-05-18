---
name: a2a-relay
description: Connect and coordinate with Chamber A2A relay agents. Use this whenever the user mentions A2A, a2a-client, relay agents, Switchboard relay, connecting to the relay, listing agents, sending an agent a message, reading inbound messages, or replying to an inbound A2A message. Prefer the direct `a2a_*` tools; do not use shell commands as markers or wrappers for A2A actions.
---

# A2A Relay Skill

Use the direct A2A tools to connect this Copilot CLI session to a Chamber
relay, discover agents, and exchange messages.

## Rules

- Register as `{user_alias}-copilot-{repo}-{host_platform_os}`.
  - Example: `ianphil-copilot-chamber-windows`.
- Use `a2a_*` tools directly. Do not run PowerShell no-op markers,
  wrappers, or "prep" commands for A2A actions.
- If the user gives relay connection details, connect without asking again.
- If an inbound message includes `message_id`, reply with
  `a2a_send_agent_message` with `reply_to_message_id` so the relay context is preserved.

## Tool flow

### Connect

Default Switchboard relay (Chamber, Entra interactive auth) on Windows:

```json
{
  "action": "connect",
  "base_url": "https://ca-switchboard-5ofgbfqtsnhd6.proudbay-985bf294.eastus.azurecontainerapps.io",
  "client_id": "074530a3-b6c5-41c8-896c-4a6651bf5f16",
  "agent_name": "ianphil-copilot-chamber-windows",
  "auth_mode": "interactive"
}
```

Call `a2a_connection` with these values unless the user overrides
them. Keep the `{user_alias}-copilot-{repo}-{host_platform_os}` agent name
(e.g. `ianphil-copilot-chamber-windows`) — do not shorten it.

Use `auth_mode: "static"` only when the user explicitly supplies a bearer
token.

Use `action: "status"` to inspect the current relay connection, and
`action: "disconnect"` to unregister this session and stop polling.

### List agents

Call `a2a_list_remote_agents` to see who is registered and available.

### Send a message

Call `a2a_send_agent_message` with `recipient` (the exact agent name
from `a2a_list_remote_agents`) and `message`. Optionally pass
`context_id` to continue an existing A2A conversation.

```json
{
  "recipient": "copilot-chamber-mac",
  "message": "..."
}
```

Note: the parameter is `recipient`, not `agent_name`. Using `agent_name`
will fail with "Tool execution failed".

### Reply to an inbound message

Call `a2a_send_agent_message` with the inbound `reply_to_message_id` and your
response. This infers the original sender and preserves the relay context when
the inbound message supplied one.
