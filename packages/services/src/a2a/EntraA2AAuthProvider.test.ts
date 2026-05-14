import { describe, expect, it, vi } from 'vitest';
import { EntraA2AAuthProvider, waitForAuthorizationCode } from './EntraA2AAuthProvider';

describe('EntraA2AAuthProvider', () => {
  it('opens a PKCE authorization URL and exchanges the returned code for an access token', async () => {
    const openedUrls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_id')).toBe('client-id');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('redirect_uri')).toBe('http://localhost:48123');
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.get('scope')).toBe('openid profile offline_access api://client-id/user_impersonation');
      return jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 });
    });
    const provider = new EntraA2AAuthProvider({
      clientId: 'client-id',
      fetchImpl,
      openExternal: async (url) => { openedUrls.push(url); },
      waitForAuthorizationCode: async () => ({ code: 'auth-code', redirectUri: 'http://localhost:48123' }),
      randomBytes: () => Buffer.alloc(32, 1),
    });

    await expect(provider.getAuthorizationHeader()).resolves.toBe('Bearer access-token');
    const authorizeUrl = new URL(openedUrls[0]);
    expect(authorizeUrl.origin).toBe('https://login.microsoftonline.com');
    expect(authorizeUrl.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(authorizeUrl.searchParams.get('client_id')).toBe('client-id');
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('http://localhost:48123');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('scope')).toBe('openid profile offline_access api://client-id/user_impersonation');
  });

  it('refreshes expired tokens and deduplicates concurrent token requests', async () => {
    let now = 1_000;
    let resolveFirstToken: ((response: Response) => void) | undefined;
    const firstTokenResponse = new Promise<Response>((resolve) => {
      resolveFirstToken = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstTokenResponse)
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-token', refresh_token: 'refresh-token', expires_in: 3600 }));
    const provider = new EntraA2AAuthProvider({
      clientId: 'client-id',
      fetchImpl,
      openExternal: async () => undefined,
      waitForAuthorizationCode: async () => ({ code: 'auth-code', redirectUri: 'http://localhost:48123' }),
      randomBytes: () => Buffer.alloc(32, 2),
      now: () => now,
    });

    const first = provider.getAuthorizationHeader();
    const second = provider.getAuthorizationHeader();
    resolveFirstToken?.(jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 1 }));
    await expect(first).resolves.toBe('Bearer access-token');
    await expect(second).resolves.toBe('Bearer access-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2_000;
    await expect(provider.getAuthorizationHeader()).resolves.toBe('Bearer refreshed-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const refreshBody = new URLSearchParams(String(fetchImpl.mock.calls[1][1]?.body));
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('refresh-token');
  });

  it('accepts the browser callback on the advertised localhost redirect URI', async () => {
    const callback = await waitForAuthorizationCode('state-1');
    try {
      const response = await fetch(`${callback.redirectUri}/?code=auth-code&state=state-1`);

      await expect(response.text()).resolves.toContain('Switchboard login complete');
      await expect(callback.code).resolves.toBe('auth-code');
    } finally {
      callback.dispose?.();
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
