import { randomBytes } from 'node:crypto';
import type { ChamberCtx } from './types';

/**
 * Inputs to {@link createServerContext}. `token` and `allowedOrigins` have
 * sensible defaults; every capability is required so a deployment must
 * explicitly opt in to (or refuse) each surface rather than silently fall
 * back to a no-op.
 */
export interface ServerContextInputs extends Omit<ChamberCtx, 'token' | 'allowedOrigins'> {
  token?: string;
  allowedOrigins?: Iterable<string>;
}

export function createServerContext(inputs: ServerContextInputs): ChamberCtx {
  const { token, allowedOrigins, ...capabilities } = inputs;
  return {
    token: token ?? randomBytes(32).toString('base64url'),
    allowedOrigins: new Set(allowedOrigins ?? ['http://127.0.0.1']),
    ...capabilities,
  };
}
