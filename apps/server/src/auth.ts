import { timingSafeEqual } from 'node:crypto';

const AUTH_SCHEME = 'Bearer ';

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.split(':')[0].toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '[::1]' || normalized === '::1';
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: ReadonlySet<string>): boolean {
  if (origin === null) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const withoutPort = `${parsed.protocol}//${parsed.hostname}`;
    return isLoopbackHost(parsed.hostname) && allowedOrigins.has(withoutPort);
  } catch {
    return false;
  }
}

export function isAuthorized(authorization: string | null, token: string): boolean {
  if (!authorization?.startsWith(AUTH_SCHEME)) return false;
  const candidate = authorization.slice(AUTH_SCHEME.length);
  const candidateBuffer = Buffer.from(candidate);
  const tokenBuffer = Buffer.from(token);
  return candidateBuffer.length === tokenBuffer.length && timingSafeEqual(candidateBuffer, tokenBuffer);
}
