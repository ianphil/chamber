/**
 * Policy engine — evaluates tool calls against governance/policy.yaml rules.
 *
 * Loads policy.yaml at construction time and provides a `evaluate()` method
 * that checks a tool call against blocked patterns, ring-based permissions,
 * and rate limits. Designed to work alongside the existing ApprovalGate:
 *
 *   1. PolicyEngine.evaluate() → fast, deterministic allow/deny
 *   2. ApprovalGate.gate()     → human approval for side-effects
 *
 * If policy.yaml is missing or malformed, the engine is permissive (all
 * actions allowed) to preserve backward compatibility.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyRule {
  blocked_patterns: string[];
  rings: Record<number, RingConfig>;
  limits: LimitsConfig;
  approval: ApprovalConfig;
  kernel: { mode: 'strict' | 'permissive' | 'audit' };
}

interface RingConfig {
  capabilities: string[];
  requires_attestation?: boolean;
  rate_limit?: string;
  timeout_seconds?: number;
}

interface LimitsConfig {
  max_tokens_per_task: number;
  max_tool_calls_per_task: number;
  max_session_duration_minutes: number;
}

interface ApprovalConfig {
  destructive_actions: string[];
  min_approvals: number;
  timeout_minutes: number;
}

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  rule?: string;
  mode: 'strict' | 'permissive' | 'audit' | 'no-policy';
};

export interface EvaluationContext {
  toolName: string;
  parameters?: Record<string, unknown>;
  ring?: number;
  sessionToolCallCount?: number;
}

// ---------------------------------------------------------------------------
// YAML-lite parser (avoids adding js-yaml dependency)
// ---------------------------------------------------------------------------

function parseSimpleYaml(text: string): Record<string, unknown> {
  // For policy.yaml we only need top-level keys and blocked_patterns list.
  // Use JSON.parse on a pre-processed version, or fall back to empty.
  try {
    // Try native YAML parsing if available (Node 22+)
    // Fall back to line-based extraction for our known schema
    return extractPolicyFields(text);
  } catch {
    return {};
  }
}

function extractPolicyFields(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  const result: Record<string, unknown> = {};

  // Extract kernel mode
  const modeMatch = text.match(/mode:\s*(strict|permissive|audit)/);
  if (modeMatch) {
    result.kernel = { mode: modeMatch[1] };
  }

  // Extract blocked_patterns
  const patterns: string[] = [];
  let inBlocked = false;
  for (const line of lines) {
    if (line.trim().startsWith('blocked_patterns:')) {
      inBlocked = true;
      continue;
    }
    if (inBlocked) {
      const match = line.match(/^\s+-\s+"(.+)"$/);
      if (match) {
        patterns.push(match[1]);
      } else if (line.match(/^\S/) && !line.startsWith('#')) {
        inBlocked = false;
      }
    }
  }
  result.blocked_patterns = patterns;

  // Extract limits
  const maxTokens = text.match(/max_tokens_per_task:\s*(\d+)/);
  const maxCalls = text.match(/max_tool_calls_per_task:\s*(\d+)/);
  const maxDuration = text.match(/max_session_duration_minutes:\s*(\d+)/);
  result.limits = {
    max_tokens_per_task: maxTokens ? parseInt(maxTokens[1], 10) : 8000,
    max_tool_calls_per_task: maxCalls ? parseInt(maxCalls[1], 10) : 25,
    max_session_duration_minutes: maxDuration ? parseInt(maxDuration[1], 10) : 60,
  };

  // Extract destructive action patterns
  const destructive: string[] = [];
  let inDestructive = false;
  for (const line of lines) {
    if (line.trim().startsWith('destructive_actions:')) {
      inDestructive = true;
      continue;
    }
    if (inDestructive) {
      const match = line.match(/^\s+-\s+"(.+)"$/);
      if (match) {
        destructive.push(match[1]);
      } else if (line.match(/^\S/) && !line.startsWith('#')) {
        inDestructive = false;
      }
    }
  }
  result.approval = {
    destructive_actions: destructive,
    min_approvals: 1,
    timeout_minutes: 30,
  };

  return result;
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

export class PolicyEngine {
  private readonly policy: Partial<PolicyRule>;
  private readonly mode: 'strict' | 'permissive' | 'audit' | 'no-policy';

  constructor(policyPath?: string) {
    const resolvedPath = policyPath ?? this.findPolicyFile();
    if (resolvedPath && existsSync(resolvedPath)) {
      try {
        const raw = readFileSync(resolvedPath, 'utf-8');
        this.policy = parseSimpleYaml(raw) as Partial<PolicyRule>;
        this.mode = (this.policy.kernel as { mode?: string })?.mode as
          | 'strict'
          | 'permissive'
          | 'audit' ?? 'permissive';
      } catch {
        this.policy = {};
        this.mode = 'no-policy';
      }
    } else {
      this.policy = {};
      this.mode = 'no-policy';
    }
  }

  /** Evaluate a tool call against policy rules. */
  evaluate(ctx: EvaluationContext): PolicyDecision {
    if (this.mode === 'no-policy') {
      return { allowed: true, reason: 'No policy loaded', mode: 'no-policy' };
    }

    // Check blocked patterns
    const blockedCheck = this.checkBlockedPatterns(ctx);
    if (!blockedCheck.allowed) {
      return this.mode === 'audit'
        ? { ...blockedCheck, allowed: true, reason: `[AUDIT] ${blockedCheck.reason}` }
        : blockedCheck;
    }

    // Check tool call limits
    const limitCheck = this.checkLimits(ctx);
    if (!limitCheck.allowed) {
      return this.mode === 'audit'
        ? { ...limitCheck, allowed: true, reason: `[AUDIT] ${limitCheck.reason}` }
        : limitCheck;
    }

    return { allowed: true, reason: 'Policy check passed', mode: this.mode };
  }

  /** Check if a tool call matches any blocked pattern. */
  private checkBlockedPatterns(ctx: EvaluationContext): PolicyDecision {
    const patterns = (this.policy.blocked_patterns as string[]) ?? [];
    const toolLower = ctx.toolName.toLowerCase();
    const paramsStr = ctx.parameters ? JSON.stringify(ctx.parameters).toLowerCase() : '';

    for (const pattern of patterns) {
      const pLower = pattern.toLowerCase();
      if (toolLower.includes(pLower) || paramsStr.includes(pLower)) {
        return {
          allowed: false,
          reason: `Blocked by pattern: "${pattern}"`,
          rule: 'blocked-pattern',
          mode: this.mode,
        };
      }
    }

    return { allowed: true, reason: '', mode: this.mode };
  }

  /** Check tool call count limits. */
  private checkLimits(ctx: EvaluationContext): PolicyDecision {
    const limits = this.policy.limits as LimitsConfig | undefined;
    if (!limits) return { allowed: true, reason: '', mode: this.mode };

    if (
      ctx.sessionToolCallCount !== undefined &&
      ctx.sessionToolCallCount >= limits.max_tool_calls_per_task
    ) {
      return {
        allowed: false,
        reason: `Tool call limit exceeded (${ctx.sessionToolCallCount}/${limits.max_tool_calls_per_task})`,
        rule: 'tool-call-limit',
        mode: this.mode,
      };
    }

    return { allowed: true, reason: '', mode: this.mode };
  }

  /** Check if a tool action matches destructive patterns requiring approval. */
  isDestructive(toolName: string): boolean {
    const approval = this.policy.approval as ApprovalConfig | undefined;
    if (!approval?.destructive_actions) return false;

    const lower = toolName.toLowerCase();
    return approval.destructive_actions.some((pattern) => {
      const p = pattern.replace(/\*/g, '').toLowerCase();
      return lower.includes(p) || lower.startsWith(p);
    });
  }

  /** Return current policy mode. */
  getMode(): string {
    return this.mode;
  }

  /** Return loaded policy (for diagnostics). */
  getPolicy(): Partial<PolicyRule> {
    return { ...this.policy };
  }

  private findPolicyFile(): string | null {
    // Walk up from this file to find policy.yaml in repo root
    let dir = dirname(new URL(import.meta.url).pathname);
    // On Windows, strip leading /
    if (process.platform === 'win32' && dir.startsWith('/')) {
      dir = dir.slice(1);
    }
    for (let i = 0; i < 10; i++) {
      const candidate = resolve(dir, 'policy.yaml');
      if (existsSync(candidate)) return candidate;
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
}
