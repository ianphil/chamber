// Runtime surface check for the published `chamber-copilot` package.
//
// Why this test exists:
//
//   `chamber-copilot` ships pure ESM JavaScript with `"types": null`. We
//   maintain a hand-rolled type shim at `chamber-copilot.d.ts` that mirrors
//   only the symbols Chamber consumes directly. TypeScript will happily
//   compile against the shim regardless of what the published package
//   actually exports — so an upstream rename or removal that we don't
//   notice during a version bump produces "TypeError: undefined is not a
//   function" at runtime in production code paths.
//
//   The dependency is now pinned exactly (no caret) in root `package.json`
//   to force every bump through PR review. This test is the second line of
//   defense: it asserts every value-level symbol the shim declares exists
//   at runtime, that the documented constants have the documented shapes,
//   and — most importantly — that `MindScopedJobs.prototype` mirrors every
//   `JobStore.prototype` method the shim declares. The duck-typed
//   `scoped as unknown as JobStore` cast in `ChamberCopilotService.getToolsForMind`
//   would otherwise let drift slip through silently.
//
//   If this test fails after a `chamber-copilot` bump, audit the shim and
//   `MindScopedJobs` together — do not patch the test in isolation.

import { describe, it, expect } from 'vitest';
import * as chamberCopilot from 'chamber-copilot';
import { MindScopedJobs } from './MindScopedJobs';

// Methods the shim declares on `JobStore`. These are the only methods
// chamber-copilot's own `createAcpTools` wires through to a `JobStore`
// shape today; they are also the methods Chamber calls directly. Both
// `JobStore.prototype` and `MindScopedJobs.prototype` must expose every
// one of them.
const SHIM_DECLARED_JOBSTORE_METHODS = [
  'delegate',
  'respond',
  'approve',
  'cancel',
  'status',
  'list',
] as const;

const SHIM_DECLARED_ACPCONNECTION_METHODS = ['start', 'stop'] as const;

describe('chamber-copilot package surface', () => {
  describe('value-level exports declared by chamber-copilot.d.ts', () => {
    it('exports the expected runtime symbols with the expected typeof', () => {
      expect(typeof chamberCopilot.AcpConnection).toBe('function');
      expect(typeof chamberCopilot.JobStore).toBe('function');
      expect(typeof chamberCopilot.UnsupportedPermissionModeError).toBe('function');
      expect(typeof chamberCopilot.createAcpTools).toBe('function');
      expect(typeof chamberCopilot.defaultAcpConnectionFactory).toBe('function');
    });

    it('PERMISSION_MODES is the documented set of {safe, yolo}', () => {
      expect(chamberCopilot.PERMISSION_MODES).toBeInstanceOf(Set);
      const modes = [...chamberCopilot.PERMISSION_MODES].sort();
      expect(modes).toEqual(['safe', 'yolo']);
    });

    it("DEFAULT_PERMISSION_MODE is 'safe'", () => {
      expect(chamberCopilot.DEFAULT_PERMISSION_MODE).toBe('safe');
    });

    it('YOLO_ACP_ARGS is a non-empty array including --yolo', () => {
      expect(Array.isArray(chamberCopilot.YOLO_ACP_ARGS)).toBe(true);
      expect(chamberCopilot.YOLO_ACP_ARGS.length).toBeGreaterThan(0);
      expect(chamberCopilot.YOLO_ACP_ARGS).toContain('--yolo');
    });

    it('UnsupportedPermissionModeError is a subclass of Error', () => {
      const instance = new chamberCopilot.UnsupportedPermissionModeError('yolo');
      expect(instance).toBeInstanceOf(Error);
      expect(instance.name).toBe('UnsupportedPermissionModeError');
    });
  });

  describe('JobStore method surface', () => {
    it.each(SHIM_DECLARED_JOBSTORE_METHODS)(
      "JobStore.prototype.%s exists at runtime",
      (method) => {
        const proto = chamberCopilot.JobStore.prototype as unknown as Record<string, unknown>;
        expect(typeof proto[method]).toBe('function');
      },
    );
  });

  describe('MindScopedJobs duck-typed mirror', () => {
    // INVARIANT: MindScopedJobs is cast through `as unknown as JobStore`
    // when handed to `createAcpTools`. If chamber-copilot adds a new
    // method to `JobStore` AND declares it in our shim, this mirror must
    // grow the same method or the cli_* tools that consume it will throw
    // "is not a function" at runtime. This test traps that drift.
    it.each(SHIM_DECLARED_JOBSTORE_METHODS)(
      "MindScopedJobs.prototype.%s mirrors the shim-declared JobStore method",
      (method) => {
        const proto = MindScopedJobs.prototype as unknown as Record<string, unknown>;
        expect(typeof proto[method]).toBe('function');
      },
    );
  });

  describe('AcpConnection method surface', () => {
    it.each(SHIM_DECLARED_ACPCONNECTION_METHODS)(
      "AcpConnection.prototype.%s exists at runtime",
      (method) => {
        const proto = chamberCopilot.AcpConnection.prototype as unknown as Record<string, unknown>;
        expect(typeof proto[method]).toBe('function');
      },
    );
  });
});
