/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { A2AInboundApprovalRequest } from '@chamber/shared/a2a-types';
import type { MindContext } from '@chamber/shared/types';
import { installElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { InboundA2AApprovalBanner } from './InboundA2AApprovalBanner';
import { InboundA2AReviewPanel } from './InboundA2AReviewPanel';

const targetMind: MindContext = {
  mindId: 'q-1234',
  mindPath: 'C:\\agents\\q',
  identity: { name: 'Q', systemMessage: '' },
  status: 'ready',
};

function makeApproval(overrides: Partial<A2AInboundApprovalRequest> = {}): A2AInboundApprovalRequest {
  return {
    id: 'approval-1',
    digest: 'digest-1',
    kind: 'message',
    targetMindId: targetMind.mindId,
    request: {
      recipient: targetMind.mindId,
      message: {
        messageId: 'message-1',
        role: 'ROLE_USER',
        parts: [{ text: 'Please review the deployment plan.' }],
      },
    },
    sender: {
      identity: {
        authentication: 'entra',
        principalId: 'sender-principal',
        tenantId: 'sender-tenant',
      },
      agent: {
        name: 'Verified Sender',
        identifier: 'sender-agent',
      },
    },
    recipient: {
      identity: {
        authentication: 'entra',
        principalId: 'recipient-principal',
        tenantId: 'recipient-tenant',
      },
      agent: {
        name: 'Q',
        identifier: targetMind.mindId,
      },
    },
    preview: 'Please review the deployment plan.',
    state: 'pending',
    receivedAt: '2026-07-12T14:00:00.000Z',
    expiresAt: '2026-07-12T14:15:00.000Z',
    ...overrides,
  };
}

function renderApprovals(testInitialState: Partial<AppState>) {
  return render(
    <AppStateProvider testInitialState={testInitialState}>
      <InboundA2AApprovalBanner />
      <div className="flex">
        <div>Current view remains visible</div>
        <InboundA2AReviewPanel />
      </div>
    </AppStateProvider>,
  );
}

describe('inbound A2A approvals', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  it('hides approval UI when the Switchboard Relay feature flag is disabled', () => {
    renderApprovals({
      featureFlags: { switchboardRelay: false, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      pendingA2AApprovals: [makeApproval()],
    });

    expect(screen.queryByRole('heading', { name: 'External agent request' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Review inbound A2A request' })).toBeNull();
  });

  it('aggregates pending requests into one banner', () => {
    renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      minds: [targetMind],
      pendingA2AApprovals: [
        makeApproval(),
        makeApproval({
          id: 'approval-2',
          digest: 'digest-2',
          preview: 'Second request should not stack.',
        }),
      ],
    });

    expect(screen.getAllByRole('heading', { name: 'External agent request' })).toHaveLength(1);
    expect(screen.getByText('2 pending')).toBeTruthy();
    expect(screen.getByText('Verified Sender')).toBeTruthy();
    expect(screen.getByText('Q')).toBeTruthy();
    expect(screen.getByText('Please review the deployment plan.')).toBeTruthy();
    expect(screen.queryByText('Second request should not stack.')).toBeNull();
  });

  it('opens and closes the review panel without replacing the current view', () => {
    renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      minds: [targetMind],
      pendingA2AApprovals: [makeApproval()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review inbound request from Verified Sender' }));

    expect(screen.getByRole('heading', { name: 'Review inbound A2A request' })).toBeTruthy();
    expect(screen.getByText('Current view remains visible')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close inbound A2A review' }));

    expect(screen.queryByRole('heading', { name: 'Review inbound A2A request' })).toBeNull();
    expect(screen.getByText('Current view remains visible')).toBeTruthy();
  });

  it('shows the full escaped request and verified sender details', () => {
    const requestText = '<script>alert("not html")</script>\nFull request body';
    const { container } = renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      minds: [targetMind],
      pendingA2AApprovals: [makeApproval({
        kind: 'task',
        request: {
          recipient: targetMind.mindId,
          message: {
            messageId: 'message-1',
            role: 'ROLE_USER',
            parts: [{ text: requestText }],
          },
        },
      })],
      selectedA2AApprovalId: 'approval-1',
    });

    const panel = screen.getByRole('complementary', { name: 'Review inbound A2A request' });
    expect(panel.querySelector('pre')?.textContent).toBe(requestText);
    expect(container.querySelector('script')).toBeNull();
    expect(within(panel).getByText('task')).toBeTruthy();
    expect(within(panel).getByText('sender-principal')).toBeTruthy();
    expect(within(panel).getByText('sender-tenant')).toBeTruthy();
    expect(within(panel).getByText('Verified Sender')).toBeTruthy();
    expect(within(panel).getByText('Q')).toBeTruthy();
    expect(within(panel).getByText(new Date('2026-07-12T14:00:00.000Z').toLocaleString())).toBeTruthy();
    expect(within(panel).getByText(new Date('2026-07-12T14:15:00.000Z').toLocaleString())).toBeTruthy();
  });

  it('approves once with the request id and digest and disables duplicate actions', async () => {
    const api = installElectronAPI();
    let resolveApproval: () => void = () => undefined;
    (api.a2a.approvePendingRequest as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => {
      resolveApproval = () => resolve(makeApproval({ state: 'approved' }));
    }));
    renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      pendingA2AApprovals: [makeApproval()],
      selectedA2AApprovalId: 'approval-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));

    expect(api.a2a.approvePendingRequest).toHaveBeenCalledWith('approval-1', 'digest-1');
    expect((screen.getByRole('button', { name: 'Approving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Decline' }).every((button) => button.hasAttribute('disabled'))).toBe(true);

    resolveApproval();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Review inbound A2A request' })).toBeNull();
    });
  });

  it('declines with the request id and digest', async () => {
    const api = installElectronAPI();
    (api.a2a.declinePendingRequest as ReturnType<typeof vi.fn>).mockResolvedValue(makeApproval({ state: 'declined' }));
    renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      pendingA2AApprovals: [makeApproval()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Decline inbound request from Verified Sender' }));

    await waitFor(() => {
      expect(api.a2a.declinePendingRequest).toHaveBeenCalledWith('approval-1', 'digest-1');
    });
  });

  it('surfaces action failures inline', async () => {
    const api = installElectronAPI();
    (api.a2a.declinePendingRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Request expired'));
    renderApprovals({
      featureFlags: { switchboardRelay: true, byoLlm: false, chamberCopilot: false, voiceDictation: false, wtdTopology: false },
      pendingA2AApprovals: [makeApproval()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Decline inbound request from Verified Sender' }));

    expect(await screen.findByText('Request expired')).toBeTruthy();
    expect(screen.getByText('Request expired').getAttribute('role')).toBe('alert');
  });
});
