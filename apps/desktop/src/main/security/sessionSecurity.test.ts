import { describe, it, expect } from 'vitest';
import {
  buildContentSecurityPolicy,
  installContentSecurityPolicy,
  installPermissionHandlers,
} from './sessionSecurity';

interface FakeWebRequest {
  onHeadersReceived: (cb: (details: { responseHeaders?: Record<string, string[]>; resourceType?: string }, callback: (response: { responseHeaders?: Record<string, string[]> }) => void) => void) => void;
}
interface FakeSession {
  webRequest: FakeWebRequest;
  setPermissionRequestHandler: (cb: (wc: FakeWebContents, permission: string, callback: (allow: boolean) => void, details: FakePermissionRequestDetails) => void) => void;
  setPermissionCheckHandler: (cb: (wc: FakeWebContents | null, permission: string, requestingOrigin: string, details: FakePermissionCheckDetails) => boolean) => void;
}
interface FakeWebContents {
  getURL: () => string;
}
interface FakePermissionRequestDetails {
  isMainFrame: boolean;
  requestingUrl: string;
  securityOrigin?: string;
  mediaTypes?: Array<'video' | 'audio'>;
}
interface FakePermissionCheckDetails {
  isMainFrame: boolean;
  requestingUrl?: string;
  securityOrigin?: string;
  mediaType?: 'video' | 'audio' | 'unknown';
}

function fakeSession() {
  let headersHandler: ((details: { responseHeaders?: Record<string, string[]>; resourceType?: string }, callback: (response: { responseHeaders?: Record<string, string[]> }) => void) => void) | null = null;
  let permissionRequestHandler: ((wc: FakeWebContents, permission: string, callback: (allow: boolean) => void, details: FakePermissionRequestDetails) => void) | null = null;
  let permissionCheckHandler: ((wc: FakeWebContents | null, permission: string, requestingOrigin: string, details: FakePermissionCheckDetails) => boolean) | null = null;

  const session: FakeSession = {
    webRequest: {
      onHeadersReceived: (cb) => { headersHandler = cb; },
    },
    setPermissionRequestHandler: (cb) => { permissionRequestHandler = cb; },
    setPermissionCheckHandler: (cb) => { permissionCheckHandler = cb; },
  };

  return {
    session,
    invokeHeaders(details: { responseHeaders?: Record<string, string[]>; resourceType?: string } = {}): Promise<{ responseHeaders?: Record<string, string[]> }> {
      if (!headersHandler) throw new Error('onHeadersReceived not registered');
      return new Promise((resolve) => headersHandler!(details, resolve));
    },
    invokePermissionRequest(
      permission: string,
      details: FakePermissionRequestDetails = requestDetails('https://example.com/'),
    ): Promise<boolean> {
      if (!permissionRequestHandler) throw new Error('setPermissionRequestHandler not called');
      return new Promise((resolve) => permissionRequestHandler!(webContents(details.requestingUrl), permission, resolve, details));
    },
    invokePermissionCheck(
      permission: string,
      requestingOrigin = 'https://example.com/',
      details: FakePermissionCheckDetails = checkDetails(requestingOrigin),
    ): boolean {
      if (!permissionCheckHandler) throw new Error('setPermissionCheckHandler not called');
      return permissionCheckHandler(webContents(details.requestingUrl ?? requestingOrigin), permission, requestingOrigin, details);
    },
  };
}

function webContents(url: string): FakeWebContents {
  return { getURL: () => url };
}

function requestDetails(origin: string, mediaTypes: Array<'video' | 'audio'> = ['audio']): FakePermissionRequestDetails {
  return {
    isMainFrame: true,
    requestingUrl: origin,
    securityOrigin: origin,
    mediaTypes,
  };
}

function checkDetails(origin: string, mediaType: 'video' | 'audio' | 'unknown' = 'audio'): FakePermissionCheckDetails {
  return {
    isMainFrame: true,
    requestingUrl: origin,
    securityOrigin: origin,
    mediaType,
  };
}

describe('buildContentSecurityPolicy', () => {
  it('emits a strict default-src self in production mode', () => {
    expect(buildContentSecurityPolicy('production')).toContain("default-src 'self'");
  });

  it('does not include unsafe-eval in production mode', () => {
    expect(buildContentSecurityPolicy('production')).not.toContain("'unsafe-eval'");
  });

  it('includes unsafe-eval in script-src in development mode for Vite', () => {
    const csp = buildContentSecurityPolicy('development');
    expect(csp).toMatch(/script-src [^;]*'unsafe-eval'/);
  });

  it('forbids embedding the renderer in any frame', () => {
    expect(buildContentSecurityPolicy('production')).toContain("frame-ancestors 'none'");
  });

  it('forbids object and form-action sinks', () => {
    const csp = buildContentSecurityPolicy('production');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('allows the loopback server in connect-src under both localhost and 127.0.0.1', () => {
    const csp = buildContentSecurityPolicy('production');
    expect(csp).toMatch(/connect-src [^;]*http:\/\/localhost:\*/);
    expect(csp).toMatch(/connect-src [^;]*ws:\/\/localhost:\*/);
    expect(csp).toMatch(/connect-src [^;]*http:\/\/127\.0\.0\.1:\*/);
    expect(csp).toMatch(/connect-src [^;]*ws:\/\/127\.0\.0\.1:\*/);
  });

  it('allows sandboxed Canvas Lens iframes from the loopback server', () => {
    const csp = buildContentSecurityPolicy('production');
    expect(csp).toMatch(/frame-src [^;]*http:\/\/localhost:\*/);
    expect(csp).toMatch(/frame-src [^;]*http:\/\/127\.0\.0\.1:\*/);
  });

  it('does not expose external GitHub hosts in connect-src — those calls run in the main process, not the renderer', () => {
    const csp = buildContentSecurityPolicy('production');
    expect(csp).not.toMatch(/connect-src [^;]*api\.github\.com/);
    expect(csp).not.toMatch(/connect-src [^;]*api\.githubcopilot\.com/);
    expect(csp).not.toMatch(/connect-src [^;]*[^.]github\.com/);
  });
});

describe('installContentSecurityPolicy', () => {
  it('injects the CSP header on every response', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({ responseHeaders: { 'X-Other': ['value'] } });

    expect(result.responseHeaders?.['Content-Security-Policy']).toBeDefined();
    expect(result.responseHeaders?.['Content-Security-Policy']?.[0]).toContain("default-src 'self'");
  });

  it('emits the CSP header value as a single-element array per Electron contract', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({});

    const value = result.responseHeaders?.['Content-Security-Policy'];
    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(1);
  });

  it('preserves existing response headers', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({ responseHeaders: { 'X-Other': ['value'] } });

    expect(result.responseHeaders?.['X-Other']).toEqual(['value']);
  });

  it('does not crash when no responseHeaders are provided', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({});

    expect(result.responseHeaders?.['Content-Security-Policy']).toBeDefined();
  });

  it('replaces any incoming Content-Security-Policy header regardless of case', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({
      responseHeaders: {
        'content-security-policy': ["script-src 'self' 'unsafe-eval' 'unsafe-inline'"],
        'Content-Security-Policy-Report-Only': ['report-only-policy'],
        'X-Keep': ['kept'],
      },
    });

    expect(result.responseHeaders?.['content-security-policy']).toBeUndefined();
    expect(result.responseHeaders?.['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(result.responseHeaders?.['Content-Security-Policy']?.[0]).not.toContain("'unsafe-eval'");
    expect(result.responseHeaders?.['X-Keep']).toEqual(['kept']);
  });

  it('does not inject the app shell CSP into subframes such as Canvas Lens documents', async () => {
    const fake = fakeSession();
    installContentSecurityPolicy(fake.session as never, 'production');

    const result = await fake.invokeHeaders({
      resourceType: 'subFrame',
      responseHeaders: { 'X-Canvas': ['kept'] },
    });

    expect(result.responseHeaders?.['Content-Security-Policy']).toBeUndefined();
    expect(result.responseHeaders?.['X-Canvas']).toEqual(['kept']);
  });
});

describe('installPermissionHandlers', () => {
  it('allows notifications', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);

    expect(await fake.invokePermissionRequest('notifications')).toBe(true);
    expect(fake.invokePermissionCheck('notifications')).toBe(true);
  });

  it('allows audio media permissions for Chamber renderer origins', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);

    for (const origin of ['file:///app/index.html', 'http://localhost:5173/', 'http://127.0.0.1:5173/']) {
      expect(await fake.invokePermissionRequest('media', requestDetails(origin))).toBe(true);
      expect(fake.invokePermissionCheck('media', origin, checkDetails(origin))).toBe(true);
    }
  });

  it('denies media permissions from foreign origins', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);

    for (const origin of ['https://example.com/', 'http://evil.localhost.example/', 'http://0.0.0.0:5173/']) {
      expect(await fake.invokePermissionRequest('media', requestDetails(origin))).toBe(false);
      expect(fake.invokePermissionCheck('media', origin, checkDetails(origin))).toBe(false);
    }
  });

  it('denies non-audio media permission requests even from Chamber renderer origins', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);
    const origin = 'http://localhost:5173/';

    expect(await fake.invokePermissionRequest('media', requestDetails(origin, ['video']))).toBe(false);
    expect(await fake.invokePermissionRequest('media', requestDetails(origin, ['audio', 'video']))).toBe(false);
    expect(fake.invokePermissionCheck('media', origin, checkDetails(origin, 'video'))).toBe(false);
    expect(fake.invokePermissionCheck('media', origin, checkDetails(origin, 'unknown'))).toBe(false);
  });

  it('denies geolocation, midi, and other non-allowlisted permissions', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);

    const chamberOrigin = 'http://localhost:5173/';
    for (const permission of ['geolocation', 'midi', 'pointerLock', 'fullscreen', 'clipboard-read']) {
      expect(await fake.invokePermissionRequest(permission, requestDetails(chamberOrigin))).toBe(false);
      expect(fake.invokePermissionCheck(permission, chamberOrigin, checkDetails(chamberOrigin))).toBe(false);
    }
  });

  it('default-denies any permission name not on the allow-list, including unknown sentinel values', async () => {
    const fake = fakeSession();
    installPermissionHandlers(fake.session as never);

    expect(await fake.invokePermissionRequest('chamber-fake-permission-xyz')).toBe(false);
    expect(fake.invokePermissionCheck('chamber-fake-permission-xyz')).toBe(false);
  });
});
