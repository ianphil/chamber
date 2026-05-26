export type TaskRuntime = 'a2a' | 'cron' | 'acp-child' | 'chatroom' | 'local';

export type LedgerStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  | 'lost';

export type DeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'session-queued'
  | 'failed'
  | 'parent-missing'
  | 'not-applicable';

export type NotifyPolicy = 'done-only' | 'state-changes' | 'silent';

export type ScopeKind = 'session' | 'system';

export type RuntimePayload =
  | { runtime: 'cron'; kind: 'prompt' | 'shell' | 'webhook' | 'notification' }
  | { runtime: 'a2a'; a2aTaskId: string; contextId: string }
  | { runtime: 'acp-child'; rawJobId: string; cwd: string }
  | { runtime: 'chatroom'; strategy: string }
  | { runtime: 'local' };

export interface LedgerRecord {
  ledgerId: string;
  runKey?: string;
  sourceId?: string;
  runtime: TaskRuntime;
  ownerMindId: string;
  scopeKind: ScopeKind;
  parentLedgerId?: string;
  a2aTaskId?: string;
  contextId?: string;
  label?: string;
  task: string;
  status: LedgerStatus;
  notifyPolicy: NotifyPolicy;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  lastEventAt?: string;
  cleanupAfter?: string;
  error?: string;
  progressSummary?: string;
  terminalSummary?: string;
  payload: RuntimePayload;
}

export interface CancelOutcome {
  found: boolean;
  cancelled: boolean;
  reason?: string;
  task?: LedgerRecord;
}
