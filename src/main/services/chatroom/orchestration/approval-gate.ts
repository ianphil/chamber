import { randomUUID } from 'node:crypto';
import type {
  ApprovalRequest,
  ApprovalDecision,
  RiskLevel,
} from '../../../../shared/chatroom-types';
import { redactParameters } from './observability';
import type { ObservabilityEmitter } from './observability';

// ---------------------------------------------------------------------------
// Side-effect tool classification
// ---------------------------------------------------------------------------

/** Default set of tool name patterns considered side-effects */
const DEFAULT_SIDE_EFFECT_PATTERNS: readonly string[] = [
  'email', 'mail', 'calendar', 'teams', 'slack', 'post', 'send',
  'write', 'delete', 'update', 'create', 'deploy', 'publish',
  'notify', 'webhook', 'http_request', 'fetch_external',
  // M365 Copilot can take actions on the user's behalf via its own tool set,
  // so gate any chat call into it.
  'copilot_chat',
];

// ---------------------------------------------------------------------------
// ApprovalGate — intercepts side-effect tool calls
// ---------------------------------------------------------------------------

export interface ApprovalGateConfig {
  /** Tool names/patterns requiring approval */
  sideEffectPatterns?: readonly string[];
  /** Known-safe tools that never need approval */
  allowedTools?: ReadonlySet<string>;
  /** Demo mode: still gated, but auto-approves after emitting the event */
  demoMode?: boolean;
  /** Observability emitter for structured events */
  observability?: ObservabilityEmitter;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export class ApprovalGate {
  private readonly sideEffectPatterns: readonly string[];
  private readonly allowedTools: ReadonlySet<string>;
  private readonly demoMode: boolean;
  private readonly observability?: ObservabilityEmitter;
  private approvalHandler: ApprovalHandler | null = null;
  private readonly log: ApprovalLogEntry[] = [];

  constructor(config: ApprovalGateConfig = {}) {
    this.sideEffectPatterns = config.sideEffectPatterns ?? DEFAULT_SIDE_EFFECT_PATTERNS;
    this.allowedTools = config.allowedTools ?? new Set();
    this.demoMode = config.demoMode ?? false;
    this.observability = config.observability;
  }

  /** Register the handler that surfaces approval requests to the user/system */
  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  /**
   * Check whether a tool call requires approval.
   * Returns true if the tool is classified as a side-effect.
   */
  requiresApproval(toolName: string): boolean {
    if (this.allowedTools.has(toolName)) return false;
    const lower = toolName.toLowerCase();
    return this.sideEffectPatterns.some((p) => lower.includes(p));
  }

  /**
   * Gate a tool invocation. If the tool is a side-effect:
   * 1. Emit approval_requested event
   * 2. Wait for approve/deny
   * 3. Log decision
   * 4. Return whether to proceed
   *
   * Default-deny for unknown tools with no handler.
   */
  async gate(
    actorId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    reason: string = '',
  ): Promise<{ approved: boolean; correlationId: string }> {
    if (!this.requiresApproval(toolName)) {
      return { approved: true, correlationId: '' };
    }

    const correlationId = randomUUID();
    const riskLevel = this.classifyRisk(toolName);

    const request: ApprovalRequest = {
      correlationId,
      actorId,
      toolName,
      parameters: redactParameters(parameters),
      reason,
      riskLevel,
      timestamp: Date.now(),
    };

    // Emit observability event
    this.observability?.emit('approval_requested', {
      correlationId,
      actorId,
      toolName,
      riskLevel,
    });

    let decision: ApprovalDecision;

    if (this.demoMode) {
      // Demo mode: auto-approve but still emit the event for visibility
      decision = {
        correlationId,
        approved: true,
        decidedBy: 'demo-mode',
        timestamp: Date.now(),
        reason: 'Auto-approved in demo mode',
      };
    } else if (this.approvalHandler) {
      decision = await this.approvalHandler(request);
    } else {
      // Default deny: no handler registered
      decision = {
        correlationId,
        approved: false,
        decidedBy: 'system',
        timestamp: Date.now(),
        reason: 'No approval handler registered — default deny',
      };
    }

    // Log decision
    this.log.push({
      request,
      decision,
    });

    // Emit observability event
    this.observability?.emit(
      decision.approved ? 'approval_approved' : 'approval_denied',
      {
        correlationId,
        actorId,
        toolName,
        decidedBy: decision.decidedBy,
      },
    );

    return { approved: decision.approved, correlationId };
  }

  /** Get the audit log (non-sensitive, redacted parameters) */
  getAuditLog(): readonly ApprovalLogEntry[] {
    return [...this.log];
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private classifyRisk(toolName: string): RiskLevel {
    const lower = toolName.toLowerCase();
    if (lower.includes('delete') || lower.includes('deploy')) return 'critical';
    if (lower.includes('email') || lower.includes('teams') || lower.includes('send')) return 'high';
    if (lower.includes('write') || lower.includes('update') || lower.includes('create')) return 'medium';
    return 'low';
  }
}

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

export interface ApprovalLogEntry {
  request: ApprovalRequest;
  decision: ApprovalDecision;
}
