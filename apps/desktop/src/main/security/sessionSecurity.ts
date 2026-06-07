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
// GitHub OAuth + API calls run in main, not the renderer, so they are not
// listed here. Shorter allow-list = clearer enforcement boundary.
const CONNECT_SRC =
  "connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* http://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:*";

// sha256 of the inline theme-init <script> in apps/web/index.html. That script
// resolves the stored/system theme before first paint to avoid a light/dark
// flash, so it must run inline (a deferred module script paints too late).
// 'self' alone blocks it in both modes; allow exactly this one script by hash.
// INVARIANT: if the inline script changes, recompute this hash or the theme
// flash returns. sessionSecurity.test.ts pins it against index.html.
const THEME_INIT_SCRIPT_HASH = "'sha256-AUm0KqVrGXLR/Qiq2JcOTfKhJCyRoAhNDwHbn7hMFWE='";

export function buildContentSecurityPolicy(mode: SecurityMode): string {
  const scriptSrc =
    mode === 'development'
      ? `script-src 'self' 'unsafe-eval' ${THEME_INIT_SCRIPT_HASH}`
      : `script-src 'self' ${THEME_INIT_SCRIPT_HASH}`;

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

export function installPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}
