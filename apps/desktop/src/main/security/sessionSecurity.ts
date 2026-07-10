import type { Session } from 'electron';

export type SecurityMode = 'development' | 'production';

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['notifications']);
const CHAMBER_RENDERER_HTTP_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

const COMMON_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
] as const;

// Renderer-side network surface only:
//   - 'self'     — same-origin (Vite dev server, packaged file://, MVP loopback server)
//   - localhost  — MVP loopback server + Vite HMR (ws + http variants)
//   - 127.0.0.1  — same as localhost; MVP server may emit either host name
// GitHub OAuth + API calls run in main, not the renderer, so they are not
// listed here. Shorter allow-list = clearer enforcement boundary.
const CONNECT_SRC =
  "connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* http://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:*";

export function buildContentSecurityPolicy(mode: SecurityMode): string {
  const scriptSrc =
    mode === 'development'
      ? "script-src 'self' 'unsafe-eval'"
      : "script-src 'self'";

  return [...COMMON_DIRECTIVES, scriptSrc, CONNECT_SRC].join('; ');
}

function stripExistingCspHeaders(
  headers: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  if (!headers) return next;
  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();
    if (lowered === 'content-security-policy' || lowered === 'content-security-policy-report-only') {
      continue;
    }
    next[name] = value;
  }
  return next;
}

export function installContentSecurityPolicy(session: Session, mode: SecurityMode): void {
  const csp = buildContentSecurityPolicy(mode);
  session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType && details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...stripExistingCspHeaders(details.responseHeaders),
        'Content-Security-Policy': [csp],
      },
    });
  });
}

export interface PermissionHandlerOptions {
  readonly allowAudioCapture?: boolean;
}

export function installPermissionHandlers(session: Session, options: PermissionHandlerOptions = {}): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isPermissionAllowed(permission, {
        allowAudioCapture: options.allowAudioCapture === true,
        origin: getPermissionRequestOrigin(webContents, details),
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
        isMainFrame: details.isMainFrame,
      }),
    );
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    isPermissionAllowed(permission, {
      allowAudioCapture: options.allowAudioCapture === true,
      origin: details.securityOrigin ?? requestingOrigin ?? details.requestingUrl ?? webContents?.getURL(),
      mediaTypes: details.mediaType ? [details.mediaType] : undefined,
      isMainFrame: details.isMainFrame,
    }),
  );
}

function getPermissionRequestOrigin(
  webContents: Parameters<NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>>[0],
  details: Parameters<NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>>[3],
): string | undefined {
  return ('securityOrigin' in details ? details.securityOrigin : undefined) ?? details.requestingUrl ?? webContents.getURL();
}

interface PermissionDecisionInput {
  readonly allowAudioCapture: boolean;
  readonly origin?: string;
  readonly mediaTypes?: ReadonlyArray<'video' | 'audio' | 'unknown'>;
  readonly isMainFrame: boolean;
}

function isPermissionAllowed(permission: string, input: PermissionDecisionInput): boolean {
  if (ALLOWED_PERMISSIONS.has(permission)) return true;
  if (permission !== 'media') return false;
  if (!input.allowAudioCapture) return false;
  if (!input.isMainFrame) return false;
  if (!isChamberRendererOrigin(input.origin)) return false;

  return input.mediaTypes?.length === 1 && input.mediaTypes[0] === 'audio';
}

function isChamberRendererOrigin(originOrUrl: string | undefined): boolean {
  if (!originOrUrl) return false;
  if (originOrUrl.startsWith('file://')) return true;

  try {
    const parsed = new URL(originOrUrl);
    if (parsed.protocol !== 'http:') return false;
    return CHAMBER_RENDERER_HTTP_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
