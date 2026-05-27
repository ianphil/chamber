import type { PermissionHandler, PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

// Some `approve-for-session` decisions require detail fields that should not be
// guessed if the handler-side request does not expose enough context:
//
//   - `shell` requires `commandIdentifiers: string[]`
//   - `mcp` requires `serverName`
//   - `custom-tool` requires `toolName`
//   - `url` and `hook` have no `approve-for-session` variant in the protocol
//
// For those kinds we fall back to `approve-once` until a future PR
// (issue #131 checklist 5) wires the richer `permission.requested`
// session event so the handler can see command identifiers, server
// names, etc.
//
// Read / write / memory have unconditional `approve-for-session`
// variants, so we use them — that means the SDK stops re-invoking the
// handler for the rest of the session for those kinds, which is the
// whole point of issue #131 checklist 4.
export const approveForSessionCompat: PermissionHandler = (
  request: PermissionRequest,
): PermissionRequestResult => {
  switch (request.kind) {
    case 'read':
      return { kind: 'approve-for-session', approval: { kind: 'read' } };
    case 'write':
      return { kind: 'approve-for-session', approval: { kind: 'write' } };
    case 'memory':
      return { kind: 'approve-for-session', approval: { kind: 'memory' } };
    case 'shell':
    case 'mcp':
    case 'custom-tool':
    case 'url':
    case 'hook':
    case 'extension-management':
    case 'extension-permission-access':
    default:
      return { kind: 'approve-once' };
  }
};
