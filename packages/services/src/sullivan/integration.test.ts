/**
 * Sullivan end-to-end integration smoke (Phase 6).
 *
 * Exercises the full chain `@chamber/services` barrel →
 * `SullivanToolsService` → `getToolsForMind()` → handler →
 * structured return, the same way `apps/desktop/src/main.ts:38` and
 * `apps/server/src/bin.ts:19` consume the service at runtime — without
 * spinning up Electron and without spinning up the HTTP server.
 *
 * Importing via the package barrel (rather than the local
 * `./SullivanToolsService`) is the whole point: this smoke catches a
 * regression where the Phase 5 barrel export
 * (`packages/services/src/index.ts:17`) silently drops Sullivan and the
 * composition roots fail to resolve the class. The unit shape tests in
 * `tools.test.ts` and `SullivanToolsService.test.ts` cover the internals;
 * this file pins the public surface the apps actually consume.
 */
import { describe, it, expect } from 'vitest';

import { SullivanToolsService } from '@chamber/services';
import type { SessionTool } from '../a2a/tools';
import type { ContrastCheckResult, MotionBudgetResult } from './tools';

const MIND_ID = 'mind-smoke';
const MIND_PATH = '/tmp/mind-smoke';

const TOOL_NAMES = [
  'presentation_template',
  'presentation_outline_validate',
  'presentation_critique',
  'presentation_contrast_check',
  'presentation_motion_budget',
] as const;

function resolveSessionTool(
  service: SullivanToolsService,
  name: (typeof TOOL_NAMES)[number],
): SessionTool {
  const tools = service.getToolsForMind(MIND_ID, MIND_PATH) as unknown as SessionTool[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found on provider`);
  return tool;
}

describe('Sullivan tools end-to-end integration', () => {
  it('SullivanToolsService is reachable through the @chamber/services barrel and constructs standalone', () => {
    // The barrel re-export landed in Phase 5; without it the imports in
    // apps/desktop/src/main.ts and apps/server/src/bin.ts would not
    // resolve. Constructing via the barrel-imported class — with no
    // arguments and no collaborators — is exactly what both composition
    // roots do.
    const service = new SullivanToolsService();
    expect(typeof service.getToolsForMind).toBe('function');
    expect(typeof service.activateMind).toBe('function');
    expect(typeof service.releaseMind).toBe('function');
  });

  it('getToolsForMind returns the five Sullivan tools in stable, documented order', () => {
    const service = new SullivanToolsService();
    const tools = service.getToolsForMind(MIND_ID, MIND_PATH);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('presentation_contrast_check composes barrel → service → handler → Phase 1 primitive', async () => {
    const service = new SullivanToolsService();
    const tool = resolveSessionTool(service, 'presentation_contrast_check');

    const result = (await tool.handler({
      pairs: [{ foreground: '#000000', background: '#ffffff', label: 'body' }],
    })) as readonly ContrastCheckResult[];

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    const entry = result[0];
    // Black on white is the canonical maximum-contrast pair:
    // (1 + 0.05) / (0 + 0.05) = 21.
    expect(entry.ratio).toBe(21);
    expect(entry.label).toBe('body');
    expect(entry.foreground).toBe('#000000');
    expect(entry.background).toBe('#ffffff');
    expect(entry.AA).toEqual({ largeText: true, normalText: true });
    expect(entry.AAA).toEqual({ largeText: true, normalText: true });
    expect(typeof entry.recommendation).toBe('string');
    expect(entry.recommendation.length).toBeGreaterThan(0);
  });

  it('presentation_motion_budget composes barrel → service → handler → Phase 2 primitive', async () => {
    const service = new SullivanToolsService();
    const tool = resolveSessionTool(service, 'presentation_motion_budget');

    const result = (await tool.handler({
      transitions: [{ id: 't1', durationMs: 400, type: 'fade' }],
    })) as MotionBudgetResult;

    expect(typeof result).not.toBe('string');
    expect(result.perTransition).toHaveLength(1);
    const [first] = result.perTransition;
    expect(first.id).toBe('t1');
    expect(first.durationMs).toBe(400);
    expect(first.type).toBe('fade');
    expect(first.withinPerTransitionBudget).toBe(true);
    expect(typeof first.reducedMotionEquivalent).toBe('string');
    expect(first.reducedMotionEquivalent.length).toBeGreaterThan(0);
    expect(typeof first.recommendation).toBe('string');

    expect(result.aggregate.totalDurationMs).toBe(400);
    expect(result.aggregate.withinAggregateBudget).toBe(true);
    expect(typeof result.aggregate.recommendation).toBe('string');
  });

  it('activateMind and releaseMind are idempotent no-ops (stateless v1 contract)', async () => {
    const service = new SullivanToolsService();
    await expect(service.activateMind(MIND_ID, MIND_PATH)).resolves.toBeUndefined();
    await expect(service.activateMind(MIND_ID, MIND_PATH)).resolves.toBeUndefined();
    await expect(service.releaseMind(MIND_ID)).resolves.toBeUndefined();
    await expect(service.releaseMind(MIND_ID)).resolves.toBeUndefined();
  });
});
