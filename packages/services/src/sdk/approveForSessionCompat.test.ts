import { describe, expect, it } from 'vitest';
import { approveForSessionCompat } from './approveForSessionCompat';

const invocation = { sessionId: 'session-1' };

describe('approveForSessionCompat (issue #131 checklist 4)', () => {
  describe('approve-for-session decisions', () => {
    it('approves read for the rest of the session', async () => {
      const decision = await approveForSessionCompat({ kind: 'read', toolCallId: 'r1' }, invocation);
      expect(decision).toEqual({
        kind: 'approve-for-session',
        approval: { kind: 'read' },
      });
    });

    it('approves write for the rest of the session', async () => {
      const decision = await approveForSessionCompat({ kind: 'write', toolCallId: 'w1' }, invocation);
      expect(decision).toEqual({
        kind: 'approve-for-session',
        approval: { kind: 'write' },
      });
    });

    it('approves memory for the rest of the session', async () => {
      const decision = await approveForSessionCompat({ kind: 'memory', toolCallId: 'm1' }, invocation);
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
      const decision = await approveForSessionCompat({ kind: 'shell', toolCallId: 's1' }, invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves mcp once (no serverName available in the handler-side request)', async () => {
      const decision = await approveForSessionCompat({ kind: 'mcp', toolCallId: 'mcp1' }, invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves custom-tool once (no toolName available in the handler-side request)', async () => {
      const decision = await approveForSessionCompat({ kind: 'custom-tool', toolCallId: 'ct1' }, invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves url once (no per-session variant in the SDK)', async () => {
      const decision = await approveForSessionCompat({ kind: 'url', toolCallId: 'u1' }, invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });

    it('approves hook once (no per-session variant in the SDK)', async () => {
      const decision = await approveForSessionCompat({ kind: 'hook', toolCallId: 'h1' }, invocation);
      expect(decision).toEqual({ kind: 'approve-once' });
    });
  });

  describe('end-to-end auto-approve preserved', () => {
    it('never returns reject', async () => {
      const kinds: Array<'shell' | 'write' | 'mcp' | 'read' | 'url' | 'custom-tool' | 'memory' | 'hook'> = [
        'shell', 'write', 'mcp', 'read', 'url', 'custom-tool', 'memory', 'hook',
      ];
      for (const kind of kinds) {
        const decision = await approveForSessionCompat({ kind }, invocation);
        expect(decision.kind).not.toBe('reject');
        expect(decision.kind).not.toBe('user-not-available');
      }
    });
  });
});
