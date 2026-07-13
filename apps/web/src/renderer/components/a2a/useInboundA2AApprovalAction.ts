import { useCallback } from 'react';
import type { A2AInboundApprovalRequest } from '@chamber/shared/a2a-types';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useAppDispatch, useAppState } from '../../lib/store';

export function useInboundA2AApprovalAction() {
  const { a2aApprovalAction } = useAppState();
  const dispatch = useAppDispatch();

  const decide = useCallback(async (
    approval: A2AInboundApprovalRequest,
    decision: 'approve' | 'decline',
  ) => {
    if (a2aApprovalAction) return;

    dispatch({
      type: 'A2A_APPROVAL_ACTION_STARTED',
      payload: { id: approval.id, decision },
    });
    try {
      const updatedApproval = decision === 'approve'
        ? await window.electronAPI.a2a.approvePendingRequest(approval.id, approval.digest)
        : await window.electronAPI.a2a.declinePendingRequest(approval.id, approval.digest);
      dispatch({ type: 'APPLY_A2A_APPROVAL_STATE', payload: updatedApproval });
      dispatch({ type: 'A2A_APPROVAL_ACTION_COMPLETED', payload: { id: approval.id } });
    } catch (error: unknown) {
      dispatch({
        type: 'A2A_APPROVAL_ACTION_FAILED',
        payload: { id: approval.id, message: getErrorMessage(error) },
      });
    }
  }, [a2aApprovalAction, dispatch]);

  return {
    action: a2aApprovalAction,
    decide,
  };
}
