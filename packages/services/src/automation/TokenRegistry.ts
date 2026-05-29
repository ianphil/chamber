import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface MintedToken {
  /** Opaque bearer token (base64url, 32 bytes random). */
  token: string;
  /** Bound mind id. The bridge enforces that requests target only this mind. */
  mindId: string;
  /** Bound run id (the cron run that owns this subprocess). */
  runId: string;
}

interface TokenEntry {
  mindId: string;
  runId: string;
  /** Prebuilt Buffer for timing-safe equality. */
  buffer: Buffer;
  revoked: boolean;
}

/**
 * Holds the set of currently-valid bridge tokens. One token is minted per
 * subprocess spawn, scoped to the spawn's `{mindId, runId}`. Revoked when
 * the subprocess exits for any reason (normal/error/timeout/cancel).
 *
 * Comparison uses `timingSafeEqual` exclusively. The registry walks all
 * entries on every verify so timing does not leak which tokens exist.
 */
export class TokenRegistry {
  private readonly entries = new Map<string, TokenEntry>();

  mint(mindId: string, runId: string): MintedToken {
    const token = randomBytes(32).toString('base64url');
    const buffer = Buffer.from(token, 'utf8');
    this.entries.set(token, { mindId, runId, buffer, revoked: false });
    return { token, mindId, runId };
  }

  verify(provided: string): { mindId: string; runId: string } | null {
    if (typeof provided !== 'string' || provided.length === 0) return null;
    const providedBuf = Buffer.from(provided, 'utf8');
    let matched: TokenEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.revoked) continue;
      if (entry.buffer.length !== providedBuf.length) continue;
      if (timingSafeEqual(entry.buffer, providedBuf)) {
        matched = entry;
        // Intentionally no early-return — finish the walk to keep timing flat.
      }
    }
    if (!matched) return null;
    return { mindId: matched.mindId, runId: matched.runId };
  }

  revoke(token: string): void {
    const entry = this.entries.get(token);
    if (entry) entry.revoked = true;
    this.entries.delete(token);
  }

  revokeRun(runId: string): void {
    for (const [token, entry] of this.entries.entries()) {
      if (entry.runId === runId) {
        entry.revoked = true;
        this.entries.delete(token);
      }
    }
  }

  size(): number {
    return this.entries.size;
  }
}
