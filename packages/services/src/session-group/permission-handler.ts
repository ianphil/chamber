import type {
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
} from '@github/copilot-sdk';
import type { ApprovalGate } from './approval-gate';
import type { PermissionHandlerFactory } from './types';

// ---------------------------------------------------------------------------
// createApprovalGatePermissionFactory
// ---------------------------------------------------------------------------

/**
 * Build a `PermissionHandlerFactory` that routes every SDK permission
 * request through Chamber's `ApprovalGate`. Lifted verbatim from
 * `ChatroomService.createPermissionHandler` so behavior is unchanged;
 * the only difference is that it lives next to `SessionGroup` and is
 * injected as a policy.
 */
export function createApprovalGatePermissionFactory(
  approvalGate: ApprovalGate,
): PermissionHandlerFactory {
  return (mindId: string): PermissionHandler => {
    return async (
      request: PermissionRequest,
      invocation: { sessionId: string },
    ): Promise<PermissionRequestResult> => {
      const toolName = permissionToolName(request);
      const { approved, reason } = await approvalGate.gate(
        mindId,
        toolName,
        {
          kind: request.kind,
          toolCallId: request.toolCallId,
          sessionId: invocation.sessionId,
        },
        `Copilot requested permission for ${request.kind}`,
      );

      if (approved) {
        return { kind: 'approve-once' };
      }

      return {
        kind: 'reject',
        feedback: reason
          ? `Denied by Chamber approval gate: ${reason}`
          : 'Denied by Chamber approval gate',
      };
    };
  };
}

function permissionToolName(request: PermissionRequest): string {
  switch (request.kind) {
    case 'custom-tool':
      return 'custom_tool';
    case 'mcp':
      return 'mcp_tool';
    default:
      return request.kind;
  }
}
