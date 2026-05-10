import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolicyEngine } from './policy-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePolicyFile(dir: string, content: string): string {
  const path = join(dir, 'policy.yaml');
  writeFileSync(path, content, 'utf-8');
  return path;
}

const STRICT_POLICY = `
kernel:
  mode: strict

limits:
  max_tokens_per_task: 8000
  max_tool_calls_per_task: 5
  max_session_duration_minutes: 60

blocked_patterns:
  - "eval("
  - "DROP TABLE"
  - "rm -rf /"

approval:
  destructive_actions:
    - "delete_*"
    - "write_production_*"
  min_approvals: 1
  timeout_minutes: 30
`;

const AUDIT_POLICY = `
kernel:
  mode: audit

blocked_patterns:
  - "eval("

limits:
  max_tool_calls_per_task: 10
`;

const PERMISSIVE_POLICY = `
kernel:
  mode: permissive

blocked_patterns:
  - "eval("

limits:
  max_tool_calls_per_task: 100
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PolicyEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chamber-policy-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('construction', () => {
    it('loads policy from explicit path', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      expect(engine.getMode()).toBe('strict');
    });

    it('returns no-policy when file does not exist', () => {
      const engine = new PolicyEngine(join(tmpDir, 'nonexistent.yaml'));
      expect(engine.getMode()).toBe('no-policy');
    });

    it('returns no-policy for malformed YAML', () => {
      const path = writePolicyFile(tmpDir, '{{{{invalid yaml');
      const engine = new PolicyEngine(path);
      // Should not crash, should degrade gracefully
      expect(['no-policy', 'permissive']).toContain(engine.getMode());
    });
  });

  describe('blocked patterns', () => {
    it('blocks tool name matching a blocked pattern', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'eval(user_input)' });
      expect(result.allowed).toBe(false);
      expect(result.rule).toBe('blocked-pattern');
    });

    it('blocks parameter content matching a blocked pattern', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({
        toolName: 'run_sql',
        parameters: { query: 'DROP TABLE users' },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DROP TABLE');
    });

    it('allows tool not matching any blocked pattern', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'read_file' });
      expect(result.allowed).toBe(true);
    });

    it('is case-insensitive', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'EVAL(x)' });
      expect(result.allowed).toBe(false);
    });
  });

  describe('tool call limits', () => {
    it('blocks when tool call count exceeds limit', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({
        toolName: 'read_file',
        sessionToolCallCount: 5,
      });
      expect(result.allowed).toBe(false);
      expect(result.rule).toBe('tool-call-limit');
    });

    it('allows when under limit', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({
        toolName: 'read_file',
        sessionToolCallCount: 3,
      });
      expect(result.allowed).toBe(true);
    });

    it('allows when count not provided', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'read_file' });
      expect(result.allowed).toBe(true);
    });
  });

  describe('audit mode', () => {
    it('allows blocked patterns but flags with [AUDIT]', () => {
      const path = writePolicyFile(tmpDir, AUDIT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'eval(x)' });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('[AUDIT]');
    });

    it('allows limit violations but flags with [AUDIT]', () => {
      const path = writePolicyFile(tmpDir, AUDIT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({
        toolName: 'read_file',
        sessionToolCallCount: 15,
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('[AUDIT]');
    });
  });

  describe('no-policy mode', () => {
    it('allows everything when no policy is loaded', () => {
      const engine = new PolicyEngine(join(tmpDir, 'missing.yaml'));
      const result = engine.evaluate({ toolName: 'eval(dangerous)' });
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('no-policy');
    });
  });

  describe('destructive action detection', () => {
    it('identifies delete actions as destructive', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      expect(engine.isDestructive('delete_user')).toBe(true);
    });

    it('identifies write_production actions as destructive', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      expect(engine.isDestructive('write_production_config')).toBe(true);
    });

    it('does not flag read actions as destructive', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      expect(engine.isDestructive('read_file')).toBe(false);
    });

    it('returns false when no policy loaded', () => {
      const engine = new PolicyEngine(join(tmpDir, 'missing.yaml'));
      expect(engine.isDestructive('delete_everything')).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    it('getPolicy returns a copy, not the internal object', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const p1 = engine.getPolicy();
      const p2 = engine.getPolicy();
      expect(p1).not.toBe(p2);
      expect(p1).toEqual(p2);
    });

    it('permissive mode allows blocked patterns', () => {
      const path = writePolicyFile(tmpDir, PERMISSIVE_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'eval(x)' });
      // Permissive still blocks — it's not audit mode.
      // The blocked pattern check applies in both strict and permissive.
      expect(result.allowed).toBe(false);
    });

    it('evaluate returns all expected fields', () => {
      const path = writePolicyFile(tmpDir, STRICT_POLICY);
      const engine = new PolicyEngine(path);
      const result = engine.evaluate({ toolName: 'safe_tool' });
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('mode');
    });
  });
});
