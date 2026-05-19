import { listStoredGitHubCredentials } from '@chamber/services';
import type { CredentialStore } from '@chamber/services';

export interface CanAccessOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

/**
 * Returns true when Chamber's runtime would be able to fetch `/repos/${nwo}`
 * with either the anonymous GitHub API or one of the credentials the runtime
 * itself would consider eligible.
 *
 * "Credentials the runtime would consider eligible" means the result of
 * `listStoredGitHubCredentials` — entries in the `copilot-cli` keytar service
 * whose account matches Chamber's `https://github.com:<login>` prefix.
 * Enterprise/EMU-shape accounts (`https://github.com/enterprises/microsoft:<login>`)
 * live in the same keytar service but are filtered out by Chamber's runtime
 * (`packages/services/src/auth/AuthService.ts:36-45`), so this helper filters
 * them out too. Without that filter, the test guard would consider a repo
 * accessible because an EMU token can reach it, but the runtime would then
 * fail because it never uses those tokens.
 *
 * A credential-store failure is treated as "no credentials" — same as the
 * runtime's `GitHubRegistryClient.safeCredentials()` swallow at
 * `packages/services/src/genesis/GitHubRegistryClient.ts:143-148`.
 */
export async function canAccessRepoWithChamberCredentials(
  nwo: string,
  credentialStore: CredentialStore,
  options: CanAccessOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const userAgent = options.userAgent ?? 'Chamber/e2e';

  if (await canFetch(fetchImpl, userAgent, nwo, null)) return true;

  let chamberCredentials;
  try {
    chamberCredentials = await listStoredGitHubCredentials(credentialStore);
  } catch {
    return false;
  }

  for (const credential of chamberCredentials) {
    if (await canFetch(fetchImpl, userAgent, nwo, credential.password)) return true;
  }
  return false;
}

async function canFetch(
  fetchImpl: typeof fetch,
  userAgent: string,
  nwo: string,
  token: string | null,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${nwo}`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': userAgent,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
