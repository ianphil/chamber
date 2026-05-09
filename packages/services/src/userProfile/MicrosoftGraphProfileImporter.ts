import path from 'node:path';
import fs from 'node:fs';
import {
  PromptValue,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
} from '@azure/msal-node';
import {
  DataProtectionScope,
  FilePersistenceWithDataProtection,
  NativeBrokerPlugin,
  PersistenceCachePlugin,
} from '@azure/msal-node-extensions';
import type { UserProfileImportResult, UserProfileSaveRequest } from '@chamber/shared/types';
import type { UserProfileService } from './UserProfileService';

const GRAPH_SCOPES = ['https://graph.microsoft.com/User.Read'];
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName,jobTitle,companyName,officeLocation,city';
const GRAPH_PHOTO_URL = 'https://graph.microsoft.com/v1.0/me/photos/96x96/$value';
const MICROSOFT_TENANT_ID = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const VSCODE_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56';

export interface MicrosoftGraphToken {
  accessToken: string;
  accountUsername?: string;
}

export interface MicrosoftGraphTokenProvider {
  acquireToken(): Promise<MicrosoftGraphToken>;
}

export interface MsalBrokerGraphTokenProviderOptions {
  authDataDir: string;
  openBrowser: (url: string) => Promise<void>;
  clientId?: string;
  tenantId?: string;
}

interface GraphUser {
  displayName?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  companyName?: string;
  officeLocation?: string;
  city?: string;
}

export class MicrosoftGraphProfileImporter {
  private inFlight = false;

  constructor(
    private readonly profileService: Pick<UserProfileService, 'getProfile' | 'saveMicrosoftProfile'>,
    private readonly tokenProvider: MicrosoftGraphTokenProvider,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async importProfile(): Promise<UserProfileImportResult> {
    if (this.inFlight) {
      return {
        success: false,
        error: 'Microsoft profile import is already in progress.',
        profile: this.profileService.getProfile(),
      };
    }
    this.inFlight = true;
    try {
      const token = await this.tokenProvider.acquireToken();
      const user = await this.fetchGraphJson<GraphUser>(GRAPH_ME_URL, token.accessToken);
      const avatarDataUrl = await this.fetchGraphPhoto(token.accessToken);
      const request = mapGraphUser(user, avatarDataUrl, token.accountUsername);
      const profile = this.profileService.saveMicrosoftProfile(request);
      return {
        success: true,
        profile,
        importedFields: importedFields(request),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        profile: this.profileService.getProfile(),
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchGraphJson<T>(url: string, accessToken: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw await graphError(response, 'Microsoft Graph profile request failed');
    return response.json() as Promise<T>;
  }

  private async fetchGraphPhoto(accessToken: string): Promise<string | null> {
    const response = await this.fetchImpl(GRAPH_PHOTO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await graphError(response, 'Microsoft Graph photo request failed');
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }
}

export class MsalBrokerGraphTokenProvider implements MicrosoftGraphTokenProvider {
  private appPromise: Promise<PublicClientApplication> | null = null;

  constructor(private readonly options: MsalBrokerGraphTokenProviderOptions) {}

  async acquireToken(): Promise<MicrosoftGraphToken> {
    const app = await this.getApp();
    const accounts = await app.getAllAccounts();
    for (const account of accounts) {
      const result = await tryAcquireSilent(app, account);
      if (result?.accessToken) {
        return { accessToken: result.accessToken, accountUsername: result.account?.username ?? account.username };
      }
    }

    const promptNone = await tryAcquirePromptNone(app, this.options.openBrowser);
    const interactive = promptNone ?? await app.acquireTokenInteractive({
      scopes: GRAPH_SCOPES,
      openBrowser: this.options.openBrowser,
    });
    if (!interactive?.accessToken) {
      throw new Error('Microsoft broker authentication did not return an access token.');
    }
    return {
      accessToken: interactive.accessToken,
      accountUsername: interactive.account?.username,
    };
  }

  private getApp(): Promise<PublicClientApplication> {
    this.appPromise ??= createBrokerApp(this.options);
    return this.appPromise;
  }
}

async function createBrokerApp(options: MsalBrokerGraphTokenProviderOptions): Promise<PublicClientApplication> {
  fs.mkdirSync(options.authDataDir, { recursive: true });
  const persistence = await FilePersistenceWithDataProtection.create(
    path.join(options.authDataDir, 'msal-cache.json'),
    DataProtectionScope.CurrentUser,
  );
  const config: Configuration = {
    auth: {
      clientId: options.clientId ?? VSCODE_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${options.tenantId ?? MICROSOFT_TENANT_ID}`,
    },
    cache: {
      cachePlugin: new PersistenceCachePlugin(persistence),
    },
    broker: {
      nativeBrokerPlugin: new NativeBrokerPlugin(),
    },
  };
  return new PublicClientApplication(config);
}

async function tryAcquireSilent(app: PublicClientApplication, account: AccountInfo): Promise<AuthenticationResult | null> {
  try {
    return await app.acquireTokenSilent({
      account,
      scopes: GRAPH_SCOPES,
    });
  } catch {
    return null;
  }
}

async function tryAcquirePromptNone(app: PublicClientApplication, openBrowser: (url: string) => Promise<void>): Promise<AuthenticationResult | null> {
  try {
    return await app.acquireTokenInteractive({
      scopes: GRAPH_SCOPES,
      prompt: PromptValue.NONE,
      openBrowser,
    });
  } catch {
    return null;
  }
}

function mapGraphUser(user: GraphUser, avatarDataUrl: string | null, accountUsername?: string): UserProfileSaveRequest & { microsoftAccount?: string } {
  const microsoftAccount = nonEmpty(user.userPrincipalName) ?? nonEmpty(accountUsername);
  return {
    displayName: nonEmpty(user.displayName) ?? '',
    work: nonEmpty(user.jobTitle) ?? nonEmpty(user.companyName) ?? '',
    location: nonEmpty(user.officeLocation) ?? nonEmpty(user.city) ?? '',
    avatarDataUrl,
    ...(microsoftAccount ? { microsoftAccount } : {}),
  };
}

function importedFields(request: UserProfileSaveRequest): Array<'displayName' | 'work' | 'location' | 'avatarDataUrl'> {
  const fields: Array<'displayName' | 'work' | 'location' | 'avatarDataUrl'> = [];
  if (request.displayName) fields.push('displayName');
  if (request.work) fields.push('work');
  if (request.location) fields.push('location');
  if (request.avatarDataUrl) fields.push('avatarDataUrl');
  return fields;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function graphError(response: Response, prefix: string): Promise<Error> {
  const requestId = response.headers.get('request-id') ?? response.headers.get('client-request-id');
  const body = await response.text();
  const requestDetail = requestId ? ` Request ID: ${requestId}.` : '';
  const bodyDetail = body.trim().length > 0 ? ` ${body}` : '';
  return new Error(`${prefix} (${response.status}).${requestDetail}${bodyDetail}`);
}
