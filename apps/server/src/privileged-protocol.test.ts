import { describe, expect, it } from 'vitest';
import { createCredentialPrivilegedHandler, parsePrivilegedRequest } from './privileged-protocol';
import type { CredentialStore } from '@chamber/services';

describe('privileged protocol', () => {
  it('rejects unsupported protocol versions', () => {
    expect(() =>
      parsePrivilegedRequest({
        protoVersion: 999,
        type: 'credential.findCredentials',
        requestId: 'r1',
        payload: { service: 'copilot-cli' },
      }),
    ).toThrow('Unsupported privileged protocol version');
  });

  it('requires requestId', () => {
    expect(() =>
      parsePrivilegedRequest({
        protoVersion: 1,
        type: 'credential.findCredentials',
        payload: { service: 'copilot-cli' },
      }),
    ).toThrow('requestId');
  });

  it('rejects unsupported request types', () => {
    expect(() =>
      parsePrivilegedRequest({
        protoVersion: 1,
        type: 'credential.getPassword',
        requestId: 'r1',
        payload: { service: 'copilot-cli', account: 'octocat' },
      }),
    ).toThrow('Unsupported privileged request type');
  });

  it('requires setPassword payload fields', () => {
    expect(() =>
      parsePrivilegedRequest({
        protoVersion: 1,
        type: 'credential.setPassword',
        requestId: 'r1',
        payload: { service: 'copilot-cli', account: 'octocat' },
      }),
    ).toThrow('password');
  });

  it('finds credentials through the credential store without echoing the request', async () => {
    const store = createCredentialStore();
    store.findCredentials = async (service) => {
      store.calls.push(['findCredentials', service]);
      return [{ account: 'octocat', password: 'secret' }];
    };
    const handler = createCredentialPrivilegedHandler(store);

    const response = await handler({
      protoVersion: 1,
      type: 'credential.findCredentials',
      requestId: 'r1',
      payload: { service: 'copilot-cli' },
    });

    expect(store.calls).toEqual([['findCredentials', 'copilot-cli']]);
    expect(response).toEqual({
      ok: true,
      requestId: 'r1',
      credentials: [{ account: 'octocat', password: 'secret' }],
    });
    expect(response).not.toHaveProperty('request');
  });

  it('sets passwords through the credential store without echoing secrets', async () => {
    const store = createCredentialStore();
    const handler = createCredentialPrivilegedHandler(store);

    const response = await handler({
      protoVersion: 1,
      type: 'credential.setPassword',
      requestId: 'r1',
      payload: { service: 'copilot-cli', account: 'octocat', password: 'secret' },
    });

    expect(store.calls).toEqual([['setPassword', 'copilot-cli', 'octocat', 'secret']]);
    expect(response).toEqual({ ok: true, requestId: 'r1' });
    expect(response).not.toHaveProperty('request');
  });

  it('deletes passwords through the credential store', async () => {
    const store = createCredentialStore();
    store.deletePassword = async (service, account) => {
      store.calls.push(['deletePassword', service, account]);
      return true;
    };
    const handler = createCredentialPrivilegedHandler(store);

    const response = await handler({
      protoVersion: 1,
      type: 'credential.deletePassword',
      requestId: 'r1',
      payload: { service: 'copilot-cli', account: 'octocat' },
    });

    expect(store.calls).toEqual([['deletePassword', 'copilot-cli', 'octocat']]);
    expect(response).toEqual({ ok: true, requestId: 'r1', deleted: true });
  });
});

function createCredentialStore(
  overrides: Partial<CredentialStore> = {},
): CredentialStore & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    findCredentials: async (service) => {
      calls.push(['findCredentials', service]);
      return [];
    },
    setPassword: async (service, account, password) => {
      calls.push(['setPassword', service, account, password]);
    },
    deletePassword: async (service, account) => {
      calls.push(['deletePassword', service, account]);
      return false;
    },
    ...overrides,
  };
}
