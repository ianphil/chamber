import { ShieldCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useInboundA2AApprovalAction } from './useInboundA2AApprovalAction';

export function InboundA2AReviewPanel() {
  const {
    featureFlags,
    pendingA2AApprovals,
    selectedA2AApprovalId,
    minds,
    agentProfileByMindId,
    a2aApprovalError,
  } = useAppState();
  const dispatch = useAppDispatch();
  const { action, decide } = useInboundA2AApprovalAction();

  const approval = featureFlags.switchboardRelay
    ? pendingA2AApprovals.find((candidate) => candidate.id === selectedA2AApprovalId)
    : undefined;
  if (!approval) return null;

  const senderName = approval.sender.agent?.name?.trim() || 'External agent';
  const targetMind = minds.find((mind) => mind.mindId === approval.targetMindId);
  const targetName = agentProfileByMindId[approval.targetMindId]?.displayName
    || targetMind?.identity.name
    || approval.targetMindId;
  const requestText = approval.request.message.parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string')
    .join('\n\n');
  const busy = action !== null;
  const error = a2aApprovalError?.id === approval.id ? a2aApprovalError.message : null;

  return (
    <aside
      aria-labelledby="inbound-a2a-review-heading"
      className="flex w-96 shrink-0 flex-col border-l border-amber-500/30 bg-card"
    >
      <header className="flex items-start gap-3 border-b border-border p-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-amber-300" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold" id="inbound-a2a-review-heading">Review inbound A2A request</h2>
          <p className="mt-1 text-xs text-muted-foreground">Approve this request once or decline it.</p>
        </div>
        <button
          aria-label="Close inbound A2A review"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => dispatch({ type: 'SELECT_A2A_APPROVAL', payload: null })}
          type="button"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <section aria-labelledby="inbound-a2a-request-heading">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" id="inbound-a2a-request-heading">
            Request
          </h3>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-sans text-sm text-foreground">
            {requestText || 'No text content provided.'}
          </pre>
        </section>

        <dl className="space-y-3">
          <Detail label="Kind" value={approval.kind} />
          <Detail label="Sender agent" value={senderName} />
          <Detail label="Sender principal" value={approval.sender.identity.principalId || 'Not provided'} />
          <Detail label="Sender tenant" value={approval.sender.identity.tenantId || 'Not provided'} />
          <Detail label="Target mind" value={targetName} />
          <Detail label="Received">
            <time dateTime={approval.receivedAt}>{formatDateTime(approval.receivedAt)}</time>
          </Detail>
          <Detail label="Expires">
            <time dateTime={approval.expiresAt}>{formatDateTime(approval.expiresAt)}</time>
          </Detail>
        </dl>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="flex gap-2 border-t border-border p-4">
        <button
          className="flex-1 rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={() => { void decide(approval, 'approve'); }}
          type="button"
        >
          {action?.id === approval.id && action.decision === 'approve' ? 'Approving…' : 'Approve once'}
        </button>
        <button
          className="flex-1 rounded-md border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={() => { void decide(approval, 'decline'); }}
          type="button"
        >
          {action?.id === approval.id && action.decision === 'decline' ? 'Declining…' : 'Decline'}
        </button>
      </footer>
    </aside>
  );
}

function Detail({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-foreground">{children ?? value}</dd>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
