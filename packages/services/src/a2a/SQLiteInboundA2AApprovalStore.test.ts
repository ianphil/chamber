import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { A2AInboundApprovalRequest } from './types';
import { SQLiteInboundA2AApprovalStore } from './SQLiteInboundA2AApprovalStore';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('SQLiteInboundA2AApprovalStore', () => {
  it('persists pending requests and ignores exact redelivery', () => {
    const store = createStore();
    const request = makeRequest();

    expect(store.create(request)).toBe(true);
    expect(store.create(request)).toBe(false);
    expect(store.listPending()).toEqual([request]);

    store.close();
  });

  it('claims a pending request only when its digest matches', () => {
    const store = createStore();
    store.create(makeRequest());

    expect(store.claimPending('relay-msg-1', 'wrong', '2026-07-12T10:00:00.000Z')).toBeNull();
    expect(store.claimPending('relay-msg-1', 'digest-1', '2026-07-12T10:00:00.000Z'))
      .toMatchObject({ state: 'approved' });
    expect(store.claimPending('relay-msg-1', 'digest-1', '2026-07-12T10:01:00.000Z')).toBeNull();

    store.close();
  });

  it('survives reopening the database', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a2a-approval-'));
    tempRoots.push(root);
    const databasePath = path.join(root, 'approvals.sqlite');
    const first = new SQLiteInboundA2AApprovalStore(databasePath);
    first.create(makeRequest());
    first.close();

    const second = new SQLiteInboundA2AApprovalStore(databasePath);
    expect(second.listPending()).toHaveLength(1);
    second.close();
  });

  it('records a successful same-owner retry after a delivery failure', () => {
    const store = createStore();
    store.create(makeRequest({ state: 'approved' }));

    expect(store.markDeliveryFailed('relay-msg-1', 'temporary failure', '2026-07-12T10:00:00.000Z'))
      .toMatchObject({ state: 'delivery_failed' });
    expect(store.markDelivered('relay-msg-1', '2026-07-12T10:01:00.000Z'))
      .toMatchObject({ state: 'delivered' });

    store.close();
  });
});

function createStore(): SQLiteInboundA2AApprovalStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-a2a-approval-'));
  tempRoots.push(root);
  return new SQLiteInboundA2AApprovalStore(path.join(root, 'approvals.sqlite'));
}

function makeRequest(overrides: Partial<A2AInboundApprovalRequest> = {}): A2AInboundApprovalRequest {
  return {
    id: 'relay-msg-1',
    digest: 'digest-1',
    kind: 'message',
    targetMindId: 'mind-a',
    request: {
      recipient: 'Agent A',
      message: {
        messageId: 'msg-1',
        role: 'ROLE_USER',
        parts: [{ text: 'hello' }],
      },
    },
    sender: {
      identity: { authentication: 'entra', principalId: 'principal-b' },
      agent: { name: 'Remote Agent' },
    },
    recipient: {
      identity: { authentication: 'entra', principalId: 'principal-a' },
      agent: { name: 'Agent A' },
    },
    preview: 'hello',
    state: 'pending',
    receivedAt: '2026-07-12T09:00:00.000Z',
    expiresAt: '2026-07-13T09:00:00.000Z',
    ...overrides,
  };
}
