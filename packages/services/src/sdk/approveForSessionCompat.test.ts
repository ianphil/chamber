import { describe, expect, it } from 'vitest';
import { approveForSessionCompat } from './approveForSessionCompat';
import type { PermissionRequest } from '@github/copilot-sdk';

const invocation = { sessionId: 'session-1' };

const permissionRequest = (kind: PermissionRequest['kind'], toolCallId = `${kind}-1`): PermissionRequest => {
  switch (kind) {
    case 'read':
      return { kind, toolCallId, path: 'README.md', intention: 'read a file' };
    case 'write':
      return { kind, toolCallId, fileName: 'README.md', diff: '', intention: 'write a file', canOfferSessionApproval: true };
    case 'memory':
      return { kind, toolCallId, fact: 'Use Chamber conventions.' };
    case 'shell':
      return {
        kind,
        toolCallId,
        fullCommandText: 'git status',
        intention: 'check status',
        canOfferSessionApproval: true,
        commands: [{ identifier: 'git', readOnly: true }],
        hasWriteFileRedirection: false,
        possiblePaths: [],
        possibleUrls: [],
      };
    case 'mcp':
      return { kind, toolCallId, readOnly: false, serverName: 'server', toolName: 'tool', toolTitle: 'Tool' };
    case 'custom-tool':
      return { kind, toolCallId, toolName: 'tool', toolDescription: 'Tool' };
    case 'url':
      return { kind, toolCallId, url: 'https://github.com', intention: 'fetch url' };
    case 'hook':
      return { kind, toolCallId, toolName: 'tool' };
    case 'extension-management':
      return { kind, toolCallId, operation: 'reload', extensionName: 'example' };
    case 'extension-permission-access':
      return { kind, toolCallId, extensionName: 'example', capabilities: ['tools'] };
  }
};

describe('approveForSessionCompat (issue #131 checklist 4)', () => {
  describe('approve-for-session decisions', () => {
    it('approves read for the rest of the session', async () => {
      const decision = await approveForSessionCompat(permissionRequest('read', 'r1'), invocation);
      expect(decision).toEqual({
        kind: 'approve-for-session',
        approval: { kind: 'read' },
      });
    });

    it('approves write for the rest of the session', async () => {
      const decision = await approveForSessionCompat(permissionRequest('write', 'w1'), invocation);
      expect(decision).toEqual({
        kind: 'approve-for-session',
        approval: { kind: 'write' },
      });
    });

    it('approves memory for the rest of the session', async () => {
      const decision = await approveForSessionCompat(permissionRequest('memory', 'm1'), invocation);
      expect(decision).toEqual({
        kind: 'approve-for-session',
        approval: { kind: 'memory' },
      });
    });
  });

  describe('approve-once fallback for kinds without per-session decisions', () => {
    // shell would need PermissionDecisionApproveForSessionApprovalCommands.commandIdentifiers,
    // but the handler-side PermissionRequest only carries { kind, toolCallId? }. Until the
    // handler is wired to the richer permission.requested event, fall back to approve-once.
    // In practice --allow-tool=shell auto-approves at the CLI layer so this branch is mostly
    // defensive coverage.
    it('approves shell once (no commandIdentifiers available in the handler-side request)', async () => {
      const decision = await approveForSessionCompat(permissionRequest('shell', 's1'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves mcp once (no serverName available in the handler-side request)', async () => {
      const decision = await approveForSessionCompat(permissionRequest('mcp', 'mcp1'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves custom-tool once (no toolName available in the handler-side request)', async () => {
      const decision = await approveForSessionCompat(permissionRequest('custom-tool', 'ct1'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves url once (no per-session variant in the SDK)', async () => {
      const decision = await approveForSessionCompat(permissionRequest('url', 'u1'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves hook once (no per-session variant in the SDK)', async () => {
      const decision = await approveForSessionCompat(permissionRequest('hook', 'h1'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves extension management once', async () => {
      const decision = await approveForSessionCompat(permissionRequest('extension-management'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves extension permission access once', async () => {
      const decision = await approveForSessionCompat(permissionRequest('extension-permission-access'), invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });
  });

  describe('end-to-end auto-approve preserved', () => {
    it('never returns reject', async () => {
      const kinds: PermissionRequest['kind'][] = [
        'shell', 'write', 'mcp', 'read', 'url', 'custom-tool', 'memory', 'hook',
        'extension-management', 'extension-permission-access',
      ];
      for (const kind of kinds) {
        const decision = await approveForSessionCompat(permissionRequest(kind), invocation);
        expect(decision.kind).not.toBe('reject');
        expect(decision.kind).not.toBe('user-not-available');
      }
    });
  });
});
