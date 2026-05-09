import { describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@chamber/shared/types';
import { MicrosoftGraphProfileImporter, type MicrosoftGraphTokenProvider } from './MicrosoftGraphProfileImporter';

describe('MicrosoftGraphProfileImporter', () => {
  it('imports Graph profile fields and a sized photo', async () => {
    const fixture = createFixture([
      jsonResponse({
        displayName: 'Ian Philpot',
        userPrincipalName: 'ianphil@microsoft.com',
        jobTitle: 'Principal SWE Manager',
        officeLocation: 'ATLANTA',
      }),
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    ]);

    const result = await fixture.importer.importProfile();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.importedFields).toEqual(['displayName', 'work', 'location', 'avatarDataUrl']);
    expect(result.profile).toMatchObject({
      displayName: 'Ian Philpot',
      work: 'Principal SWE Manager',
      location: 'ATLANTA',
      avatarDataUrl: 'data:image/png;base64,AQID',
      source: 'microsoft',
      microsoftAccount: 'ianphil@microsoft.com',
    });
  });

  it('treats missing Graph photos as a successful import without an avatar', async () => {
    const fixture = createFixture([
      jsonResponse({
        displayName: 'Ian Philpot',
        companyName: 'Microsoft',
        city: 'Atlanta',
      }),
      new Response('', { status: 404 }),
    ]);

    const result = await fixture.importer.importProfile();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.profile.avatarDataUrl).toBeNull();
    expect(result.importedFields).toEqual(['displayName', 'work', 'location']);
  });

  it('surfaces Graph authorization failures', async () => {
    const fixture = createFixture([
      new Response('Forbidden', { status: 403, headers: { 'request-id': 'req-1' } }),
    ]);

    const result = await fixture.importer.importProfile();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected import to fail');
    expect(result.error).toContain('403');
    expect(result.error).toContain('req-1');
  });

  it('surfaces Graph photo failures', async () => {
    const fixture = createFixture([
      jsonResponse({ displayName: 'Ian Philpot' }),
      new Response('Broken photo', { status: 500 }),
    ]);

    const result = await fixture.importer.importProfile();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected import to fail');
    expect(result.error).toContain('photo');
    expect(result.profile).toEqual(fixture.profile);
  });

  it('prevents concurrent imports', async () => {
    const responseResolvers: Array<(response: Response) => void> = [];
    const pendingResponse = new Promise<Response>((resolve) => {
      responseResolvers.push(resolve);
    });
    const fixture = createFixture([pendingResponse]);

    const first = fixture.importer.importProfile();
    const second = await fixture.importer.importProfile();
    responseResolvers[0]?.(jsonResponse({ displayName: 'Ian Philpot' }));

    expect(second.success).toBe(false);
    if (second.success) throw new Error('Expected second import to fail');
    expect(second.error).toContain('already in progress');
    await first;
  });
});

function createFixture(responses: Array<Response | Promise<Response>>) {
  const tokenProvider: MicrosoftGraphTokenProvider = {
    acquireToken: vi.fn().mockResolvedValue({
      accessToken: 'token',
      accountUsername: 'broker@microsoft.com',
    }),
  };
  const profile: UserProfile = {
    displayName: '',
    work: '',
    location: '',
    about: '',
    avatarDataUrl: null,
    source: 'local',
    updatedAt: null,
  };
  const profileService = {
    getProfile: vi.fn(() => profile),
    saveMicrosoftProfile: vi.fn((request) => ({
      ...profile,
      ...request,
      source: 'microsoft' as const,
      updatedAt: '2026-05-09T00:00:00.000Z',
    })),
  };
  const fetchImpl = vi.fn(async () => {
    const response = responses.shift();
    if (!response) return new Response('', { status: 404 });
    return response;
  }) as unknown as typeof fetch;
  return {
    importer: new MicrosoftGraphProfileImporter(profileService, tokenProvider, fetchImpl),
    profile,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
