import { randomUUID } from 'node:crypto';
import type { OrchestrationMode } from '../../../../shared/chatroom-types';

// ---------------------------------------------------------------------------
// Structured observability events — safe metadata only, no chain-of-thought
// ---------------------------------------------------------------------------

/** Redaction keys — values for these parameter keys are replaced with '[REDACTED]' */
const REDACTED_KEYS = new Set([
  'password', 'secret', 'token', 'apikey', 'api_key', 'authorization',
  'cookie', 'credential', 'body', 'content', 'message',
]);

export function redactParameters(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 200) {
      redacted[key] = value.slice(0, 200) + '…[truncated]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Event schema
// ---------------------------------------------------------------------------

export type ObservabilityEventKind =
  | 'orchestration_start'
  | 'orchestration_end'
  | 'per_agent_step'
  | 'tool_call_attempted'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_denied'
  | 'failure'
  | 'timeout'
  | 'termination_reason';

export interface ObservabilityEvent {
  kind: ObservabilityEventKind;
  correlationId: string;
  timestamp: number;
  orchestrationMode: OrchestrationMode;
  data: Record<string, unknown>;
}

export type ObservabilityListener = (event: ObservabilityEvent) => void;

// ---------------------------------------------------------------------------
// ObservabilityEmitter — thin wrapper for structured event emission
// ---------------------------------------------------------------------------

export class ObservabilityEmitter {
  private listeners: ObservabilityListener[] = [];
  readonly correlationId: string;
  readonly orchestrationMode: OrchestrationMode;

  constructor(orchestrationMode: OrchestrationMode, correlationId?: string) {
    this.orchestrationMode = orchestrationMode;
    this.correlationId = correlationId ?? randomUUID();
  }

  on(listener: ObservabilityListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(kind: ObservabilityEventKind, data: Record<string, unknown> = {}): void {
    const event: ObservabilityEvent = {
      kind,
      correlationId: this.correlationId,
      timestamp: Date.now(),
      orchestrationMode: this.orchestrationMode,
      data,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Observability must never break orchestration
      }
    }
  }

  start(data: Record<string, unknown> = {}): void {
    this.emit('orchestration_start', data);
  }

  end(data: Record<string, unknown> = {}): void {
    this.emit('orchestration_end', data);
  }

  agentStep(mindId: string, extra: Record<string, unknown> = {}): void {
    this.emit('per_agent_step', { mindId, ...extra });
  }

  toolCallAttempted(
    mindId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): void {
    this.emit('tool_call_attempted', {
      mindId,
      toolName,
      parameters: redactParameters(params),
    });
  }

  failure(error: string, extra: Record<string, unknown> = {}): void {
    this.emit('failure', { error, ...extra });
  }

  terminationReason(reason: string, extra: Record<string, unknown> = {}): void {
    this.emit('termination_reason', { reason, ...extra });
  }
}
