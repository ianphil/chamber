import type { Session } from 'electron';

export type SecurityMode = 'development' | 'production';

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['notifications']);

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
//   - *.speech.microsoft.com / *.api.cognitive.microsoft.com — Azure Speech
//     STT/TTS WebSocket + REST endpoints. The renderer's Speech SDK opens a
//     wss connection directly to the region endpoint; the subscription key
//     never reaches the renderer (a short-lived token is minted in main).
// GitHub OAuth + API calls run in main, not the renderer, so they are not
// listed here. Shorter allow-list = clearer enforcement boundary.
const CONNECT_SRC =
  "connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* http://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:* "
  + 'https://*.api.cognitive.microsoft.com https://*.stt.speech.microsoft.com wss://*.stt.speech.microsoft.com https://*.tts.speech.microsoft.com wss://*.tts.speech.microsoft.com';

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
  /**
   * Lazily resolves whether microphone capture is currently permitted. Read at
   * request time (not install time) so it reflects the resolved voice feature
   * flag even though permission handlers install before the flag resolves.
   * Defaults to always-deny.
   */
  isAudioCaptureEnabled?: () => boolean;
}

export function installPermissionHandlers(
  session: Session,
  options: PermissionHandlerOptions = {},
): void {
  const isAudioCaptureEnabled = options.isAudioCaptureEnabled ?? (() => false);
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media') {
      // Microphone only, and only when the voice feature is enabled. Camera
      // (any 'video' request) is always denied.
      const mediaTypes = (details as { mediaTypes?: Array<'audio' | 'video'> } | undefined)?.mediaTypes;
      const wantsVideo = mediaTypes?.includes('video') ?? false;
      callback(isAudioCaptureEnabled() && !wantsVideo);
      return;
    }
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission === 'media') {
      const mediaType = (details as { mediaType?: 'audio' | 'video' | 'unknown' } | undefined)?.mediaType;
      return isAudioCaptureEnabled() && mediaType !== 'video';
    }
    return ALLOWED_PERMISSIONS.has(permission);
  });
}
