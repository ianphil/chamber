import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:crypto for UUID generation
const mockRandomUUID = vi.fn(() => 'approval-uuid');
vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}));

import { ApprovalGate } from './approval-gate';
import type { ApprovalRequest, ApprovalDecision } from '../../../../shared/chatroom-types';
import { ObservabilityEmitter } from './observability';

let uuidCounter = 0;
function resetUUIDs() {
  uuidCounter = 0;
  mockRandomUUID.mockImplementation(() => `approval-${++uuidCounter}`);
}

describe('ApprovalGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUUIDs();
  });

  // -------------------------------------------------------------------------
  // Classification
  // -------------------------------------------------------------------------

  it('identifies side-effect tools as requiring approval', () => {
    const gate = new ApprovalGate();

    expect(gate.requiresApproval('send_email')).toBe(true);
    expect(gate.requiresApproval('teams_post')).toBe(true);
    expect(gate.requiresApproval('calendar_create')).toBe(true);
    expect(gate.requiresApproval('delete_resource')).toBe(true);
    expect(gate.requiresApproval('webhook_trigger')).toBe(true);
  });

  it('does not require approval for safe tools', () => {
    const gate = new ApprovalGate();

    expect(gate.requiresApproval('grep')).toBe(false);
    expect(gate.requiresApproval('read_file')).toBe(false);
    expect(gate.requiresApproval('list_agents')).toBe(false);
    expect(gate.requiresApproval('search')).toBe(false);
  });

  it('respects allowedTools override', () => {
    const gate = new ApprovalGate({
      allowedTools: new Set(['send_email']),
    });

    // send_email is normally a side-effect but is in the allowlist
    expect(gate.requiresApproval('send_email')).toBe(false);
    // teams_post is still a side-effect
    expect(gate.requiresApproval('teams_post')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Default deny
  // -------------------------------------------------------------------------

  it('default-denies when no approval handler is registered', async () => {
    const gate = new ApprovalGate();

    const result = await gate.gate('agent-1', 'send_email', { to: 'user@example.com' }, 'sending report');

    expect(result.approved).toBe(false);
    expect(result.correlationId).toBe('approval-1');
  });

  // -------------------------------------------------------------------------
  // Approval flow
  // -------------------------------------------------------------------------

  it('calls approval handler and respects approval', async () => {
    const gate = new ApprovalGate();
    const handler = vi.fn(async (req: ApprovalRequest): Promise<ApprovalDecision> => ({
      correlationId: req.correlationId,
      approved: true,
      decidedBy: 'admin',
      timestamp: Date.now(),
    }));
    gate.setApprovalHandler(handler);

    const result = await gate.gate('agent-1', 'send_email', { to: 'user@example.com' }, 'sending report');

    expect(result.approved).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent-1',
        toolName: 'send_email',
        riskLevel: 'high', // email = high risk
      }),
    );
  });

  it('calls approval handler and respects denial', async () => {
    const gate = new ApprovalGate();
    gate.setApprovalHandler(async (req) => ({
      correlationId: req.correlationId,
      approved: false,
      decidedBy: 'admin',
      timestamp: Date.now(),
      reason: 'Denied by policy',
    }));

    const result = await gate.gate('agent-1', 'delete_resource', {}, 'cleanup');

    expect(result.approved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Parameter redaction
  // -------------------------------------------------------------------------

  it('redacts sensitive parameters in approval request', async () => {
    const gate = new ApprovalGate();
    let capturedRequest: ApprovalRequest | null = null;
    gate.setApprovalHandler(async (req) => {
      capturedRequest = req;
      return {
        correlationId: req.correlationId,
        approved: true,
        decidedBy: 'admin',
        timestamp: Date.now(),
      };
    });

    await gate.gate('agent-1', 'send_email', {
      to: 'user@example.com',
      password: 'secret123',
      token: 'abc',
      subject: 'Hello',
    }, 'test');

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.parameters.password).toBe('[REDACTED]');
    expect(capturedRequest!.parameters.token).toBe('[REDACTED]');
    expect(capturedRequest!.parameters.to).toBe('user@example.com'); // not sensitive
  });

  // -------------------------------------------------------------------------
  // Demo mode
  // -------------------------------------------------------------------------

  it('auto-approves in demo mode but still emits events', async () => {
    const gate = new ApprovalGate({ demoMode: true });

    const result = await gate.gate('agent-1', 'send_email', { to: 'test' }, 'demo');

    expect(result.approved).toBe(true);

    // Verify audit log contains demo-mode decision
    const log = gate.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].decision.decidedBy).toBe('demo-mode');
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  it('maintains audit log of all decisions', async () => {
    const gate = new ApprovalGate({ demoMode: true });

    await gate.gate('agent-1', 'send_email', {}, 'first');
    await gate.gate('agent-2', 'delete_resource', {}, 'second');

    const log = gate.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0].request.actorId).toBe('agent-1');
    expect(log[1].request.actorId).toBe('agent-2');
  });

  // -------------------------------------------------------------------------
  // Skips gate for non-side-effect tools
  // -------------------------------------------------------------------------

  it('passes through non-side-effect tools without gating', async () => {
    const gate = new ApprovalGate();
    const handler = vi.fn();
    gate.setApprovalHandler(handler);

    const result = await gate.gate('agent-1', 'grep', { pattern: 'test' }, 'searching');

    expect(result.approved).toBe(true);
    expect(result.correlationId).toBe(''); // No correlation — not gated
    expect(handler).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Observability integration
  // -------------------------------------------------------------------------

  it('emits observability events when approval is requested', async () => {
    const obs = new ObservabilityEmitter('handoff');
    const events: unknown[] = [];
    obs.on((e) => events.push(e));

    const gate = new ApprovalGate({ observability: obs, demoMode: true });

    await gate.gate('agent-1', 'send_email', {}, 'test');

    const kinds = events.map((e) => (e as { kind: string }).kind);
    expect(kinds).toContain('approval_requested');
    expect(kinds).toContain('approval_approved');
  });

  // -------------------------------------------------------------------------
  // Risk classification
  // -------------------------------------------------------------------------

  it('classifies risk levels correctly', async () => {
    const gate = new ApprovalGate({ demoMode: true });

    await gate.gate('a', 'delete_resource', {}, '');
    await gate.gate('a', 'send_email', {}, '');
    await gate.gate('a', 'write_file', {}, '');
    await gate.gate('a', 'update_config', {}, '');

    const log = gate.getAuditLog();
    expect(log[0].request.riskLevel).toBe('critical'); // delete
    expect(log[1].request.riskLevel).toBe('high');     // send/email
    expect(log[2].request.riskLevel).toBe('medium');   // write
    expect(log[3].request.riskLevel).toBe('medium');   // update
  });

  // -------------------------------------------------------------------------
  // Must-never rules
  // -------------------------------------------------------------------------

  it('never logs raw chain-of-thought in audit log', async () => {
    const gate = new ApprovalGate({ demoMode: true });

    await gate.gate('agent-1', 'send_email', {
      body: 'This is a long email body with chain of thought reasoning that should be redacted',
      content: 'Internal thoughts about the task',
    }, 'test');

    const log = gate.getAuditLog();
    expect(log[0].request.parameters.body).toBe('[REDACTED]');
    expect(log[0].request.parameters.content).toBe('[REDACTED]');
  });
});
