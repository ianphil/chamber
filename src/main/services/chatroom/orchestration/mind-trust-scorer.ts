/**
 * MindTrustScorer — tracks per-mind trust over time based on approval history.
 *
 * Each mind starts at a base trust score (1.0). Approved actions build trust;
 * denied or blocked actions decay it. The scorer provides:
 *
 *   - `record()` — log an approval decision for a mind
 *   - `score(mindId)` — current trust score (0.0–1.0)
 *   - `tier(mindId)` — tier label: verified | trusted | standard | probationary | untrusted
 *   - `snapshot()` — all minds and their current scores
 *
 * Trust decays on denials and recovers slowly on approvals, following
 * AGT's trust scoring philosophy (trust is hard to earn, easy to lose).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrustTier = 'verified' | 'trusted' | 'standard' | 'probationary' | 'untrusted';

export interface TrustRecord {
  mindId: string;
  score: number;
  tier: TrustTier;
  totalApproved: number;
  totalDenied: number;
  totalBlocked: number;
  lastUpdated: number;
}

export interface TrustEvent {
  mindId: string;
  toolName: string;
  outcome: 'approved' | 'denied' | 'blocked';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_SCORE = 1.0;
const MIN_SCORE = 0.0;
const MAX_SCORE = 1.0;

// Decay/recovery factors
const APPROVAL_RECOVERY = 0.02;   // Small upward nudge per approval
const DENIAL_DECAY = 0.10;        // Moderate drop per denial
const BLOCK_DECAY = 0.15;         // Larger drop per policy block

// Tier thresholds (descending)
const TIER_THRESHOLDS: [number, TrustTier][] = [
  [0.90, 'verified'],
  [0.70, 'trusted'],
  [0.50, 'standard'],
  [0.30, 'probationary'],
  [0.00, 'untrusted'],
];

// ---------------------------------------------------------------------------
// MindTrustScorer
// ---------------------------------------------------------------------------

export class MindTrustScorer {
  private readonly scores = new Map<string, number>();
  private readonly approved = new Map<string, number>();
  private readonly denied = new Map<string, number>();
  private readonly blocked = new Map<string, number>();
  private readonly lastUpdated = new Map<string, number>();
  private readonly history: TrustEvent[] = [];

  /** Record an approval/denial/block event and adjust trust. */
  record(event: TrustEvent): void {
    const { mindId, outcome, timestamp } = event;
    this.history.push(event);

    // Initialize if first time
    if (!this.scores.has(mindId)) {
      this.scores.set(mindId, BASE_SCORE);
      this.approved.set(mindId, 0);
      this.denied.set(mindId, 0);
      this.blocked.set(mindId, 0);
    }

    let current = this.scores.get(mindId)!;

    switch (outcome) {
      case 'approved':
        current = Math.min(MAX_SCORE, current + APPROVAL_RECOVERY);
        this.approved.set(mindId, (this.approved.get(mindId) ?? 0) + 1);
        break;
      case 'denied':
        current = Math.max(MIN_SCORE, current - DENIAL_DECAY);
        this.denied.set(mindId, (this.denied.get(mindId) ?? 0) + 1);
        break;
      case 'blocked':
        current = Math.max(MIN_SCORE, current - BLOCK_DECAY);
        this.blocked.set(mindId, (this.blocked.get(mindId) ?? 0) + 1);
        break;
    }

    this.scores.set(mindId, Math.round(current * 100) / 100);
    this.lastUpdated.set(mindId, timestamp);
  }

  /** Get current trust score for a mind (0.0–1.0). */
  score(mindId: string): number {
    return this.scores.get(mindId) ?? BASE_SCORE;
  }

  /** Get current trust tier for a mind. */
  tier(mindId: string): TrustTier {
    const s = this.score(mindId);
    for (const [threshold, tier] of TIER_THRESHOLDS) {
      if (s >= threshold) return tier;
    }
    return 'untrusted';
  }

  /** Get full trust record for a mind. */
  getRecord(mindId: string): TrustRecord {
    return {
      mindId,
      score: this.score(mindId),
      tier: this.tier(mindId),
      totalApproved: this.approved.get(mindId) ?? 0,
      totalDenied: this.denied.get(mindId) ?? 0,
      totalBlocked: this.blocked.get(mindId) ?? 0,
      lastUpdated: this.lastUpdated.get(mindId) ?? 0,
    };
  }

  /** Snapshot of all tracked minds. */
  snapshot(): TrustRecord[] {
    const minds = [...this.scores.keys()];
    return minds.map((id) => this.getRecord(id));
  }

  /** Get event history (for diagnostics/audit). */
  getHistory(): readonly TrustEvent[] {
    return [...this.history];
  }

  /** Reset a specific mind's trust to base score. */
  reset(mindId: string): void {
    this.scores.set(mindId, BASE_SCORE);
    this.approved.set(mindId, 0);
    this.denied.set(mindId, 0);
    this.blocked.set(mindId, 0);
  }
}
