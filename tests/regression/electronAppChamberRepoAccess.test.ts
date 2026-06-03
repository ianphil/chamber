import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '@chamber/services';
import { canAccessRepoWithChamberCredentials } from '../e2e/electron/chamberRepoAccess';

const NWO = 'agency-microsoft/genesis-minds';
const REPO_URL = `https://api.github.com/repos/${NWO}`;

const CHAMBER_FORMAT_LOGIN = 'johnhain-msft';
const CHAMBER_FORMAT_ACCOUNT = `https://github.com:${CHAMBER_FORMAT_LOGIN}`;
const CHAMBER_FORMAT_TOKEN = 'gho_personalpat0000000000000000000000000';

const EMU_FORMAT_ACCOUNT = 'https://github.com/enterprises/microsoft:johnhain_microsoft';
const EMU_FORMAT_TOKEN = 'gho_emutoken00000000000000000000000000000';
const EMU_FORMAT_ACCOUNT_TYPO = 'https://github.com/eterprises/microsoft:johnhain_microsoft';
const EMU_FORMAT_TOKEN_TYPO = 'gho_emutokentypo000000000000000000000000';

interface FakeCredentialEntry {
  account: string;
  password: string;
}

function makeStore(entries: FakeCredentialEntry[]): CredentialStore {
  return {
    findCredentials: async (service: string) => {
      if (service !== 'copilot-cli') return [];
      return entries.map((entry) => ({ ...entry }));
    },
    setPassword: async () => {
      throw new Error('setPassword should not be invoked from the read-only guard helper');
    },
    deletePassword: async () => {
      throw new Error('deletePassword should not be invoked from the read-only guard helper');
    },
  };
}

function makeErrorStore(): CredentialStore {
  return {
    findCredentials: async () => {
      throw new Error('keychain unavailable');
    },
    setPassword: async () => {
      throw new Error('setPassword should not be invoked from the read-only guard helper');
    },
    deletePassword: async () => {
      throw new Error('deletePassword should not be invoked from the read-only guard helper');
    },
  };
}

function makeOkResponse(): Response {
  return { ok: true } as unknown as Response;
}

function make404Response(): Response {
  return { ok: false, status: 404 } as unknown as Response;
}

interface FetchExpectation {
  token: string | null;
  ok: boolean;
}

function makeFetch(expectations: FetchExpectation[]): typeof fetch {
  const queue = [...expectations];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(REPO_URL);
    const next = queue.shift();
    if (!next) {
      throw new Error(`Unexpected extra fetch call after expectations were exhausted (url=${String(input)})`);
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? null;
    const expectedAuth = next.token === null ? null : `Bearer ${next.token}`;
    expect(auth).toBe(expectedAuth);
    return next.ok ? makeOkResponse() : make404Response();
  }) as unknown as typeof fetch;
}

describe('canAccessRepoWithChamberCredentials', () => {
  it('returns true when the anonymous GitHub API can reach the repo', async () => {
    const fetchImpl = makeFetch([{ token: null, ok: true }]);
    const store = makeStore([
      { account: CHAMBER_FORMAT_ACCOUNT, password: CHAMBER_FORMAT_TOKEN },
    ]);

    await expect(
      canAccessRepoWithChamberCredentials(NWO, store, { fetchImpl }),
    ).resolves.toBe(true);
  });

  it('returns true when a Chamber-format credential reaches the repo after anon fails', async () => {
    const fetchImpl = makeFetch([
      { token: null, ok: false },
      { token: CHAMBER_FORMAT_TOKEN, ok: true },
    ]);
    const store = makeStore([
      { account: CHAMBER_FORMAT_ACCOUNT, password: CHAMBER_FORMAT_TOKEN },
    ]);

    await expect(
      canAccessRepoWithChamberCredentials(NWO, store, { fetchImpl }),
    ).resolves.toBe(true);
  });

  it('returns false when only EMU-format tokens can reach the repo (the bug repro)', async () => {
    // Mirrors the failing-spec scenario in johnhain-msft/chamber#7: the keytar
    // service holds one Chamber-format credential that cannot reach the repo,
    // plus two EMU-format entries that could. The runtime filters EMU entries
    // out via listStoredGitHubCredentials, so the guard must too — otherwise
    // the guard returns true and the runtime then fails on the same fetch.
    const fetchImpl = makeFetch([
      { token: null, ok: false },
      { token: CHAMBER_FORMAT_TOKEN, ok: false },
    ]);
    const store = makeStore([
      { account: CHAMBER_FORMAT_ACCOUNT, password: CHAMBER_FORMAT_TOKEN },
      { account: EMU_FORMAT_ACCOUNT, password: EMU_FORMAT_TOKEN },
      { account: EMU_FORMAT_ACCOUNT_TYPO, password: EMU_FORMAT_TOKEN_TYPO },
    ]);

    await expect(
      canAccessRepoWithChamberCredentials(NWO, store, { fetchImpl }),
    ).resolves.toBe(false);
  });

  it('returns false when no credential can reach the repo', async () => {
    const fetchImpl = makeFetch([
      { token: null, ok: false },
      { token: CHAMBER_FORMAT_TOKEN, ok: false },
    ]);
    const store = makeStore([
      { account: CHAMBER_FORMAT_ACCOUNT, password: CHAMBER_FORMAT_TOKEN },
    ]);

    await expect(
      canAccessRepoWithChamberCredentials(NWO, store, { fetchImpl }),
    ).resolves.toBe(false);
  });

  it('returns false when the credential store throws after anon already failed', async () => {
    // Mirrors GitHubRegistryClient.safeCredentials at lines 143-148: a
    // credential-provider failure is swallowed and the request continues
    // with no credentials, ultimately surfacing a normal auth-failure path.
    const fetchImpl = makeFetch([{ token: null, ok: false }]);
    const store = makeErrorStore();

    await expect(
      canAccessRepoWithChamberCredentials(NWO, store, { fetchImpl }),
    ).resolves.toBe(false);
  });
});
