import { ShieldAlert } from 'lucide-react';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useInboundA2AApprovalAction } from './useInboundA2AApprovalAction';

export function InboundA2AApprovalBanner() {
  const {
    featureFlags,
    pendingA2AApprovals,
    minds,
    agentProfileByMindId,
    a2aApprovalError,
  } = useAppState();
  const dispatch = useAppDispatch();
  const { action, decide } = useInboundA2AApprovalAction();

  if (!featureFlags.switchboardRelay || pendingA2AApprovals.length === 0) return null;

  const approval = pendingA2AApprovals[0];
  const senderName = approval.sender.agent?.name?.trim() || 'External agent';
  const targetMind = minds.find((mind) => mind.mindId === approval.targetMindId);
  const targetName = agentProfileByMindId[approval.targetMindId]?.displayName
    || targetMind?.identity.name
    || approval.targetMindId;
  const busy = action !== null;
  const error = a2aApprovalError?.id === approval.id ? a2aApprovalError.message : null;

  return (
    <section
      aria-label="Inbound A2A approval required"
      aria-live="polite"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-amber-300" size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold">External agent request</h2>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-medium">
              {pendingA2AApprovals.length} pending
            </span>
          </div>
          <p className="mt-1 text-sm">
            <span className="font-medium">{senderName}</span>
            {' → '}
            <span className="font-medium">{targetName}</span>
          </p>
          <p className="mt-1 truncate text-xs text-amber-100/80">{approval.preview}</p>
          {error ? (
            <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label={`Review inbound request from ${senderName}`}
            className="rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => dispatch({ type: 'SELECT_A2A_APPROVAL', payload: approval.id })}
            type="button"
          >
            Review
          </button>
          <button
            aria-label={`Decline inbound request from ${senderName}`}
            className="rounded-md border border-amber-300/30 px-3 py-1.5 text-xs font-medium hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => { void decide(approval, 'decline'); }}
            type="button"
          >
            {action?.id === approval.id && action.decision === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      </div>
    </section>
  );
}
